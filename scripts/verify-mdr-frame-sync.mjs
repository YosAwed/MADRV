import { chromium } from "playwright-core";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Local-only scheduling measurement. Source/PDX/SoundFont bytes never leave this machine.
// Example: MDR_SYNC_SOURCE=... MDR_SYNC_PDX=... MDR_SYNC_SOUNDFONT=... node scripts/verify-mdr-frame-sync.mjs
// Repeat with --baseline to measure commit 962cb01 under the same conditions.
const sourcePath = process.env.MDR_SYNC_SOURCE;
const soundFontPath = process.env.MDR_SYNC_SOUNDFONT;
const pdxPath = process.env.MDR_SYNC_PDX;
if (!sourcePath || !soundFontPath) throw new Error("Set MDR_SYNC_SOURCE, MDR_SYNC_SOUNDFONT and optionally MDR_SYNC_PDX.");
const baseline = process.argv.includes("--baseline");
const baselineRef = "962cb01";
const profile = process.env.MDR_SYNC_PROFILE ?? "mobile";
const durationSeconds = Number(process.env.MDR_SYNC_SECONDS ?? 90);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("MDR_SYNC_SECONDS must be positive.");
const libraryRoot = path.resolve("client/src/lib");
const enginePath = path.join(libraryRoot, "madrvEngine.ts");
const baselineSource = file => execFileSync("git", ["show", `${baselineRef}:${path.relative(process.cwd(), file)}`], { encoding: "utf8" });
const source = baseline ? baselineSource(enginePath) : await readFile(enginePath, "utf8");
const bundle = await build({
  stdin: { contents: source, resolveDir: libraryRoot, sourcefile: "engine.ts", loader: "ts" },
  bundle: true, format: "esm", splitting: true, outdir: "/virtual-madrv-frame-sync", entryNames: "engine",
  platform: "browser", write: false, logLevel: "silent",
  plugins: baseline ? [{
    name: "baseline-local-library",
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, args => args.path.startsWith(libraryRoot + path.sep)
        ? { contents: baselineSource(args.path), loader: "ts" } : undefined);
    },
  }] : [],
});
const assets = new Map(bundle.outputFiles.map(file => ["/" + path.basename(file.path), file.contents]));
const fixtures = new Map([["/source", sourcePath], ["/soundfont", soundFontPath], ["/pdx", pdxPath]]);
const publicRoot = path.resolve("client/public");
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<script type="module">import {SignalDeckAudio} from "/engine.js";window.SignalDeckAudio=SignalDeckAudio;</script>');
      return;
    }
    const fixture = fixtures.get(pathname);
    const publicFile = path.resolve(publicRoot, "." + pathname);
    const bytes = assets.get(pathname) ?? (fixture ? await readFile(fixture)
      : publicFile.startsWith(publicRoot + path.sep) ? await readFile(publicFile).catch(() => null) : null);
    if (!bytes) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", /\.m?js$/.test(pathname) ? "text/javascript" : pathname.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
    response.end(bytes);
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const requestedSampleRate = Number(process.env.MDR_SYNC_SAMPLE_RATE ?? 0);
  if (requestedSampleRate > 0) await page.addInitScript(sampleRate => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options) { super({ ...options, sampleRate }); }
    };
  }, requestedSampleRate);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.SignalDeckAudio);
  const info = await page.evaluate(async ({ profile, hasPdx, stallMs, stallEveryMs }) => {
    const binary = async url => (await fetch(url)).arrayBuffer();
    const audio = new window.SignalDeckAudio();
    audio.setPerformanceProfile(profile);
    audio.setSoundFontMdrDelayMs(0);
    window.audio = audio;
    await audio.loadSoundFontData(await binary("/soundfont"));
    const context = audio.context;
    const state = { blocks: [], sent: [], events: [], endCount: 0, stalls: 0, midiPeak: 0, renderedFrames: 0 };
    window.syncProbe = state;
    state.sampleRate = context.sampleRate;
    const originalTimeline = audio.startMdrMidiTimeline.bind(audio);
    audio.startMdrMidiTimeline = (...args) => {
      state.startsAt = args[1];
      state.events = args[0].map(event => ({ at: event.at, bytes: Array.from(event.bytes), sourceTrack: event.sourceTrack }));
      return originalTimeline(...args);
    };
    const originalSend = audio.sendMdrMidi.bind(audio);
    const originalQueue = audio.queueSoundFontMdrMidi.bind(audio);
    audio.queueSoundFontMdrMidi = (bytes, sourceTrack, targetAt, ...rest) => {
      state.queuedTargetAt = targetAt;
      return originalQueue(bytes, sourceTrack, targetAt, ...rest);
    };
    audio.sendMdrMidi = (bytes, sourceTrack, advance, scheduleAt) => {
      const sentAt = context.currentTime;
      const requestedAt = scheduleAt ?? sentAt;
      state.sent.push({ bytes: Array.from(bytes), sourceTrack, requestedAt,
        targetAt: audio.gsMidiPort ? requestedAt : Math.max(sentAt, requestedAt), sentAt,
        // Meaningful only for the current Worklet's synchronous early dispatch.
        queuedTargetAt: audio.gsMidiPort ? state.queuedTargetAt : undefined });
      return originalSend(bytes, sourceTrack, advance, scheduleAt);
    };
    if (audio.handleMdrMidiTiming) {
      const originalTiming = audio.handleMdrMidiTiming.bind(audio);
      audio.handleMdrMidiTiming = data => {
        // Natural completion resets the live counter. Keep the last active
        // generation, including its drained queue, instead of reporting zero.
        if (data.generation === audio.playbackGeneration && data.appliedCount > 0) state.schedulingStats = { ...data };
        originalTiming(data);
      };
    }
    const originalCreate = context.createScriptProcessor.bind(context);
    const audioProcess = Object.getOwnPropertyDescriptor(ScriptProcessorNode.prototype, "onaudioprocess");
    if (!audioProcess?.set) throw new Error("Cannot independently observe ScriptProcessor output timestamps.");
    context.createScriptProcessor = (...args) => {
      const node = originalCreate(...args);
      Object.defineProperty(node, "onaudioprocess", {
        configurable: true,
        get: () => audioProcess.get?.call(node),
        set(handler) {
          audioProcess.set.call(node, typeof handler !== "function" ? handler : function(event) {
            const frames = event.outputBuffer.length;
            const block = state.hardwareEnded ? null : { startFrame: state.renderedFrames, endFrame: state.renderedFrames + frames, playbackTime: Number(event.playbackTime), callbackAt: context.currentTime };
            if (block) { state.blocks.push(block); state.renderedFrames += frames; }
            handler.call(this, event);
            if (block && audio.mdrPlayer?.isTerminated()) {
              state.hardwareEnded = true;
              state.hardwareEndAt = block.playbackTime + frames / context.sampleRate;
            }
          });
        },
      });
      return node;
    };
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    audio.gains.midi.connect(analyser);
    const samples = new Float32Array(1024);
    state.probeTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) state.midiPeak = Math.max(state.midiPeak, Math.abs(sample));
    }, 100);
    const result = await audio.playMdr(await binary("/source"), hasPdx ? await binary("/pdx") : undefined, 1, () => {}, () => {
      state.endCount++;
      state.endedAt = context.currentTime;
    });
    if (stallMs > 0 && stallEveryMs > stallMs) state.stallTimer = setInterval(() => {
      const until = performance.now() + stallMs;
      while (performance.now() < until) { /* Controlled main-thread contention, not audio-thread throttling. */ }
      state.stalls++;
    }, stallEveryMs);
    return { ...result, sampleRate: context.sampleRate };
  }, {
    profile, hasPdx: Boolean(pdxPath),
    stallMs: Number(process.env.MDR_SYNC_STALL_MS ?? 0),
    stallEveryMs: Number(process.env.MDR_SYNC_STALL_EVERY_MS ?? 500),
  });
  console.log(JSON.stringify({ phase: "started", baseline, baselineRef: baseline ? baselineRef : undefined, profile, durationSeconds, info }));
  await page.waitForFunction(seconds => window.syncProbe.endCount > 0
    || (window.syncProbe.startsAt !== undefined && window.audio.context.currentTime - window.syncProbe.startsAt >= seconds), durationSeconds,
  { timeout: durationSeconds * 1000 + 30_000 });
  const result = await page.evaluate(() => {
    const state = window.syncProbe;
    clearInterval(state.probeTimer);
    clearInterval(state.stallTimer);
    const observedUntil = state.endedAt ?? window.audio.context.currentTime;
    const signature = event => `${event.sourceTrack}:${event.bytes.join(",")}`;
    const candidates = new Map();
    state.events.forEach((event, index) => {
      const key = signature(event);
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push({ ...event, index });
    });
    const idealAt = songSeconds => {
      const block = state.blocks.find(block => songSeconds >= block.startFrame / state.sampleRate && songSeconds < block.endFrame / state.sampleRate);
      if (block) return block.playbackTime + songSeconds - block.startFrame / state.sampleRate;
      const last = state.blocks.at(-1);
      if (state.hardwareEnded && last && songSeconds >= last.endFrame / state.sampleRate) return last.playbackTime + songSeconds - last.startFrame / state.sampleRate;
      return undefined;
    };
    const matched = [];
    let unmatchedSends = 0;
    let sequenceReversals = 0;
    let priorIndex = -1;
    for (const sent of state.sent) {
      const event = candidates.get(signature(sent))?.shift();
      if (!event) { unmatchedSends++; continue; }
      if (event.index < priorIndex) sequenceReversals++;
      priorIndex = event.index;
      const target = idealAt(event.at);
      matched.push({ index: event.index, scoreSeconds: event.at, noteOn: (event.bytes[0] & 0xf0) === 0x90 && event.bytes[2] > 0,
        idealTargetAt: target, requestedAt: sent.requestedAt, queuedTargetAt: sent.queuedTargetAt,
        errorMs: target === undefined ? undefined : (sent.targetAt - target) * 1000,
        requestedErrorMs: target === undefined ? undefined : (sent.requestedAt - target) * 1000,
        deliveryLatenessMs: Math.max(0, (sent.sentAt - sent.requestedAt) * 1000) });
    }
    const summarize = values => {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
      const at = p => sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : null;
      return { count: sorted.length, min: at(0), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
    };
    const measured = matched.filter(event => Number.isFinite(event.errorMs));
    const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const firstScore = measured.at(0)?.scoreSeconds ?? 0;
    const lastScore = measured.at(-1)?.scoreSeconds ?? 0;
    const edgeWindow = Math.min(10, Math.max(1, (lastScore - firstScore) / 4));
    const first = measured.filter(event => event.scoreSeconds <= firstScore + edgeWindow);
    const last = measured.filter(event => event.scoreSeconds >= lastScore - edgeWindow);
    const xMean = mean(measured.map(event => event.scoreSeconds)) ?? 0;
    const yMean = mean(measured.map(event => event.errorMs)) ?? 0;
    const denominator = measured.reduce((sum, event) => sum + (event.scoreSeconds - xMean) ** 2, 0);
    const slope = denominator ? measured.reduce((sum, event) => sum + (event.scoreSeconds - xMean) * (event.errorMs - yMean), 0) / denominator * 60 : null;
    const matchedIndexes = new Set(matched.map(event => event.index));
    const dueButUnsent = state.events.filter((event, index) => {
      const target = idealAt(event.at);
      return target !== undefined && target <= observedUntil && !matchedIndexes.has(index);
    }).length;
    const lastBlock = state.blocks.at(-1);
    const opmElapsed = lastBlock ? lastBlock.startFrame / state.sampleRate
      + Math.max(0, Math.min((lastBlock.endFrame - lastBlock.startFrame) / state.sampleRate, observedUntil - lastBlock.playbackTime)) : 0;
    const result = {
      sampleRate: state.sampleRate, elapsedSeconds: observedUntil - state.startsAt, opmElapsedSeconds: opmElapsed,
      renderedSeconds: state.renderedFrames / state.sampleRate, audioBlocks: state.blocks.length,
      outputOverlaps: state.blocks.flatMap((block, index) => {
        const previous = state.blocks[index - 1];
        const overlapMs = previous ? (previous.playbackTime + (previous.endFrame - previous.startFrame) / state.sampleRate - block.playbackTime) * 1000 : 0;
        return overlapMs > 0.001 ? [{ index, overlapMs, previous, block }] : [];
      }).slice(0, 10),
      expectedEvents: state.events.length, sentEvents: state.sent.length, matchedEvents: matched.length,
      unmatchedSends, sequenceReversals, dueButUnsent, matchedNoteOns: measured.filter(event => event.noteOn).length,
      targetErrorMs: summarize(measured.map(event => event.errorMs)),
      requestedTargetErrorMs: summarize(measured.map(event => event.requestedErrorMs)),
      deliveryLatenessMs: summarize(matched.map(event => event.deliveryLatenessMs)),
      firstTimingOutliers: measured.filter(event => Math.abs(event.errorMs) > 3).slice(0, 10),
      firstMeanMs: mean(first.map(event => event.errorMs)), lastMeanMs: mean(last.map(event => event.errorMs)), slopeMsPerMinute: slope,
      midiPeak: state.midiPeak, endCount: state.endCount, hardwareEnded: Boolean(state.hardwareEnded), stalls: state.stalls,
      schedulingStats: state.schedulingStats,
      note: "Deadline residual against independently observed OPM output frames; not an acoustic SoundFont attack/onset measurement.",
    };
    window.audio.stop();
    return result;
  });
  if (!baseline && process.env.MDR_SYNC_CHECK_CANCEL === "1") result.cancellation = await page.evaluate(async () => {
    const audio = window.audio;
    const context = audio.context;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitUntil = async (predicate, description) => {
      const deadline = performance.now() + 3000;
      while (!predicate()) {
        if (performance.now() >= deadline) throw new Error(description);
        await wait(20);
      }
    };
    const oldGeneration = audio.playbackGeneration;
    const oldTargetAt = context.currentTime + 0.6;
    audio.sendMdrMidi([0x90, 60, 80], 16, 0, oldTargetAt);
    await waitUntil(() => audio.getMdrMidiSchedulingStats()?.pendingCount === 1, "Future MIDI was not queued in the Worklet.");
    audio.stop();
    const newGeneration = audio.playbackGeneration;
    // Also emulate a stale message arriving after stop, not just one already queued.
    audio.gsMidiPort.postMessage({ type: "madrv-midi", generation: oldGeneration,
      sourceTrack: 16, bytes: [0x90, 62, 80], targetAt: oldTargetAt });
    await waitUntil(() => context.currentTime > oldTargetAt + 0.3, "Audio clock stopped during cancellation check.");
    const cancelled = audio.getMdrMidiSchedulingStats();
    if (cancelled?.generation !== newGeneration || cancelled.appliedCount !== 0 || cancelled.pendingCount !== 0) throw new Error("Old-generation MIDI survived stop.");
    // The current generation must still work; cancellation must not permanently mute scheduling.
    const newTargetAt = context.currentTime + 0.1;
    audio.sendMdrMidi([0x90, 64, 80], 16, 0, newTargetAt);
    audio.sendMdrMidi([0x80, 64, 0], 16, 0, newTargetAt + 0.1);
    await waitUntil(() => audio.getMdrMidiSchedulingStats()?.appliedCount === 2, "Current-generation MIDI did not resume after cancellation.");
    const resumed = audio.getMdrMidiSchedulingStats();
    audio.stop();
    return { oldGeneration, newGeneration, cancelled, resumed };
  });
  console.log(JSON.stringify({ phase: "complete", baseline, profile, ...result, errors }));
  if (errors.length || result.audioBlocks === 0 || result.matchedEvents === 0 || result.unmatchedSends > 0
    || result.sequenceReversals > 0 || result.dueButUnsent > 0) throw new Error("MDR frame-sync measurement could not be completed reliably.");
  const allowedP95 = Number(process.env.MDR_SYNC_MAX_P95_MS);
  if (Number.isFinite(allowedP95) && result.targetErrorMs.p95 > allowedP95) throw new Error("MDR frame-sync p95 exceeds MDR_SYNC_MAX_P95_MS.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
