import { chromium } from "playwright-core";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Local-only real AudioContext/SoundFont regression. No fixtures are uploaded.
const sourcePath = process.env.MDR_END_SOURCE;
const soundFontPath = process.env.MDR_END_SOUNDFONT;
const pdxPath = process.env.MDR_END_PDX;
if (!sourcePath || !soundFontPath) throw new Error("Set MDR_END_SOURCE, MDR_END_SOUNDFONT and optionally MDR_END_PDX.");
const baseline = process.argv.includes("--baseline");
const source = baseline
  ? execFileSync("git", ["show", "32597e5:client/src/lib/madrvEngine.ts"], { encoding: "utf8" })
  : await readFile("client/src/lib/madrvEngine.ts", "utf8");
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
  for (const profile of (process.env.MDR_END_PROFILES ?? "desktop,mobile").split(",")) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.SignalDeckAudio);
    const info = await page.evaluate(async ({ profile, hasPdx }) => {
      const binary = async url => (await fetch(url)).arrayBuffer();
      const audio = new window.SignalDeckAudio();
      audio.setPerformanceProfile(profile);
      window.audio = audio;
      await audio.loadSoundFontData(await binary("/soundfont"));
      const state = { sent: [], samples: [], progress: [], endCount: 0 };
      window.endProbe = state;
      const originalTimeline = audio.startMdrMidiTimeline.bind(audio);
      audio.startMdrMidiTimeline = (events, startsAt, loopWindow) => {
        state.startsAt = startsAt;
        state.expectedEvents = events.length;
        state.lastScoreEventAt = events.at(-1)?.at;
        originalTimeline(events, startsAt, loopWindow);
      };
      const originalSend = audio.sendMdrMidi.bind(audio);
      audio.sendMdrMidi = (bytes, track, advance, scheduleAt) => {
        state.sent.push({ bytes, track, targetAt: Math.max(audio.context.currentTime, scheduleAt ?? 0), sentAt: audio.context.currentTime });
        originalSend(bytes, track, advance, scheduleAt);
      };
      const analyser = audio.context.createAnalyser();
      analyser.fftSize = 2048;
      audio.gains.midi.connect(analyser);
      const samples = new Float32Array(2048);
      state.timer = setInterval(() => {
        if (state.startsAt === undefined || state.endCount) return;
        const now = audio.context.currentTime;
        const terminated = audio.mdrPlayer?.isTerminated() ?? false;
        if (terminated && state.hardwareEndedAt === undefined) state.hardwareEndedAt = now;
        analyser.getFloatTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        state.samples.push({ now, peak });
      }, 30);
      return audio.playMdr(await binary("/source"), hasPdx ? await binary("/pdx") : undefined, 1,
        seconds => state.progress.push(seconds),
        () => { state.endCount++; state.endedAt = audio.context.currentTime; });
    }, { profile, hasPdx: Boolean(pdxPath) });
    console.log(JSON.stringify({ phase: "started", baseline, profile, info }));
    await page.waitForFunction(() => window.endProbe.endCount > 0, null, { timeout: Number(process.env.MDR_END_TIMEOUT_MS ?? 90000) });
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const state = window.endProbe;
      clearInterval(state.timer);
      const lastTargetAt = Math.max(...state.sent.map(event => event.targetAt));
      const afterHardwareEnd = state.samples.filter(sample => sample.now > state.hardwareEndedAt + 0.2 && sample.now < lastTargetAt);
      const result = {
        expectedEvents: state.expectedEvents, sentEvents: state.sent.length, endCount: state.endCount,
        duration: state.endedAt - state.startsAt, hardwareEnd: state.hardwareEndedAt - state.startsAt,
        lastScoreEventAt: state.lastScoreEventAt, lastTarget: lastTargetAt - state.startsAt,
        releaseSeconds: state.endedAt - lastTargetAt,
        midiEventsAfterHardwareEnd: state.sent.filter(event => event.targetAt > state.hardwareEndedAt).length,
        midiPeakAfterHardwareEnd: Math.max(0, ...afterHardwareEnd.map(sample => sample.peak)),
        finalProgress: state.progress.at(-1),
      };
      window.audio.stop();
      return result;
    });
    console.log(JSON.stringify({ phase: "complete", baseline, profile, ...result, errors }));
    if (errors.length || result.endCount !== 1 || result.sentEvents !== result.expectedEvents
      || result.midiEventsAfterHardwareEnd === 0 || result.midiPeakAfterHardwareEnd < 0.0001
      || result.releaseSeconds < 1.499
      || Math.abs(result.finalProgress - info.duration) > 0.001) throw new Error("MDR trailing MIDI regression failed");
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
