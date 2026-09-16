import { chromium } from "playwright-core";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Local-only real AudioContext/SoundFont regression. No fixtures are uploaded.
const sourcePath = process.env.MDR_SEEK_SOURCE;
const soundFontPath = process.env.MDR_SEEK_SOUNDFONT;
const pdxPath = process.env.MDR_SEEK_PDX;
if (!sourcePath || !soundFontPath) throw new Error("Set MDR_SEEK_SOURCE, MDR_SEEK_SOUNDFONT and optionally MDR_SEEK_PDX.");
const source = await readFile("client/src/lib/madrvEngine.ts", "utf8");
const bundle = await build({
  stdin: { contents: source, resolveDir: path.resolve("client/src/lib"), sourcefile: "engine.ts", loader: "ts" },
  bundle: true, format: "esm", splitting: true, outdir: "/virtual-madrv-end", entryNames: "engine",
  platform: "browser", write: false, logLevel: "silent",
});
const assets = new Map(bundle.outputFiles.map(file => ["/" + path.basename(file.path), file.contents]));
const fixtures = new Map([["/source", sourcePath], ["/soundfont", soundFontPath], ["/pdx", pdxPath]]);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<script type="module">import {SignalDeckAudio} from "/engine.js";window.SignalDeckAudio=SignalDeckAudio;</script>');
      return;
    }
    const fixture = fixtures.get(pathname);
    const publicAsset = pathname.startsWith("/manus-storage/") ? path.join("client/public/manus-storage", path.basename(pathname)) : null;
    const bytes = assets.get(pathname) ?? (fixture || publicAsset ? await readFile(fixture ?? publicAsset) : null);
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
  for (const profile of (process.env.MDR_SEEK_PROFILES ?? "desktop,mobile").split(",")) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.SignalDeckAudio);
    const result = await page.evaluate(async ({ profile, hasPdx }) => {
      const binary = async url => (await fetch(url)).arrayBuffer();
      const audio = new window.SignalDeckAudio();
      audio.setPerformanceProfile(profile);
      audio.setMaster(0);
      await audio.loadSoundFontData(await binary("/soundfont"));
      const state = { sent: [], restored: [], progress: [], endCount: 0 };
      const originalTimeline = audio.startMdrMidiTimeline.bind(audio);
      audio.startMdrMidiTimeline = (events, ...args) => {
        state.lastScoreEventAt = events.at(-1)?.at ?? 0;
        originalTimeline(events, ...args);
      };
      const originalSend = audio.sendMdrMidi.bind(audio);
      audio.sendMdrMidi = (bytes, track, advance, scheduleAt) => {
        state.sent.push({ bytes, track, targetAt: scheduleAt, generation: audio.playbackGeneration });
        originalSend(bytes, track, advance, scheduleAt);
      };
      const originalRestore = audio.restoreMdrMidiSettings.bind(audio);
      audio.restoreMdrMidiSettings = async (messages, generation) => {
        await originalRestore(messages, generation);
        state.restored.push(...messages);
      };
      const analyser = audio.context.createAnalyser();
      analyser.fftSize = 2048;
      audio.gains.midi.connect(analyser);
      const samples = new Float32Array(2048);
      let peak = 0;
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }, 20);
      const source = await binary("/source");
      const pdx = hasPdx ? await binary("/pdx") : undefined;
      const progress = seconds => state.progress.push(seconds);
      const ended = () => state.endCount++;
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const info = await audio.playMdr(source, pdx, 1, progress, ended);
      if (!audio.canSeek()) throw new Error("Internal MIDI seek was disabled");
      await wait(300);
      const offset = Math.min(info.duration * 0.5, 60);
      const before = performance.now();
      await audio.seekTo(offset);
      const preparationMs = performance.now() - before;
      const startProgress = state.progress.at(-1);
      if (Math.abs(startProgress - offset) > 0.01) throw new Error("Wrong immediate seek position");
      peak = 0;
      await wait(3000);
      const afterProgress = state.progress.at(-1);
      const midiPeak = peak;
      const count = state.sent.filter(e => e.generation === audio.playbackGeneration).length;
      const settings = state.restored.length;
      if (afterProgress < offset + 2 || afterProgress > offset + 4) throw new Error("Seek clock failed to advance: " + afterProgress);
      if (count === 0 || midiPeak < 0.00001 || settings < 2) throw new Error("No MIDI playback after seek");
      if (state.restored.some(bytes => [0x80, 0x90].includes(bytes[0] & 0xf0))) throw new Error("Old notes replayed while chasing");
      await audio.seekTo(0);
      if (state.progress.at(-1) !== 0) throw new Error("Home did not reset position");
      await wait(350);
      await audio.seekTo(info.duration);
      await wait(200);
      // End means the displayed pass's end, which need not be the last MIDI
      // pass when individual MDR tracks have different finite repeat counts.
      await audio.playMdr(source, pdx, 1, progress, ended, state.lastScoreEventAt + 1.5);
      for (let i = 0; i < 50 && !state.endCount; i++) await wait(100);
      if (state.endCount !== 1) throw new Error("Seek to End did not finish exactly once: " + JSON.stringify({
        info, progress: state.progress.slice(-5), complete: audio.mdrMidiTimelineComplete,
        lastEvent: audio.mdrMidiLastEventAt, now: audio.context.currentTime,
        timelineEnd: audio.mdrAudioTimeline?.renderedSeconds, terminated: audio.mdrPlayer?.isTerminated(),
        sent: state.sent.slice(-4), stats: audio.getMdrMidiSchedulingStats(),
      }));
      // Infinite repeat: move to a later absolute pass, then backwards within it.
      const repeatTarget = info.duration * 2 + 2;
      await audio.playMdr(source, pdx, 0, progress, ended, repeatTarget);
      const loopProgress = state.progress.at(-1);
      const loopGeneration = audio.playbackGeneration;
      await wait(1000);
      const loopSent = state.sent.filter(e => e.generation === loopGeneration).length;
      if (loopSent === 0) throw new Error("MIDI loop did not resume after seeking");
      await audio.seekTo(0);
      await wait(350);
      audio.stop();
      clearInterval(timer);
      return { info, offset, preparationMs, startProgress, afterProgress, midiPeak,
        midiEvents: count, settings, loopProgress, loopSent, endCount: state.endCount };
    }, { profile, hasPdx: Boolean(pdxPath) });
    console.log(JSON.stringify({ profile, ...result, errors }));
    if (errors.length) throw new Error("Browser exceptions: " + errors.join(", "));
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
