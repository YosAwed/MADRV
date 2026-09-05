import { chromium } from "playwright-core";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const sampleDir = process.argv[2];
const metadata = JSON.parse(
  await readFile("/tmp/madrv-library-loops.json", "utf8")
);
const names = await readdir(sampleDir);
const selected = metadata.filter(
  m =>
    m.hasLoop &&
    (!process.env.LOOP_SONGS ||
      process.env.LOOP_SONGS.split(",").includes(m.name)) &&
    (!m.pdx || names.some(n => n.toLowerCase() === m.pdx.toLowerCase()))
);
const out = process.env.LOOP_BUILD_DIR ?? "/tmp/madrv-loop-test-build";
await mkdir(out, { recursive: true });
await build({
  stdin: {
    contents:
      'export { SignalDeckAudio } from "./client/src/lib/madrvEngine.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  splitting: true,
  outdir: out,
  entryNames: "engine",
  platform: "browser",
  logLevel: "silent",
});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let file;
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<script type="module">import {SignalDeckAudio} from "/engine.js";window.SignalDeckAudio=SignalDeckAudio;</script>'
      );
      return;
    }
    if (url.pathname === "/sample")
      file = path.join(sampleDir, path.basename(url.searchParams.get("name")));
    else if (url.pathname.startsWith("/manus-storage/"))
      file = path.join(process.cwd(), "client/public", url.pathname);
    else file = path.join(out, path.basename(url.pathname));
    res.setHeader(
      "Content-Type",
      /\.m?js$/.test(file)
        ? "text/javascript"
        : file.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream"
    );
    res.end(await readFile(file));
  } catch (e) {
    res.statusCode = 404;
    res.end(String(e));
  }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const results = [];
let next = 0;
const report =
  process.env.LOOP_REPORT ?? "/tmp/madrv-loop-boundary-results.json";
async function run(song) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.SignalDeckAudio);
    const info = await page.evaluate(
      async ({ song, sf, pdx, profile }) => {
        const binary = async name =>
          (
            await fetch("/sample?name=" + encodeURIComponent(name))
          ).arrayBuffer();
        const audio = new window.SignalDeckAudio();
        audio.setPerformanceProfile(profile);
        window.audio = audio;
        await audio.loadSoundFontData(await binary(sf));
        const state = { sent: [], samples: [], ended: false };
        window.loopProbe = state;
        const originalTimeline = audio.startMdrMidiTimeline.bind(audio);
        audio.startMdrMidiTimeline = (events, startsAt, loopWindow) => {
          state.startsAt = startsAt;
          state.loopWindow = loopWindow;
          state.eventCount = events.length;
          originalTimeline(events, startsAt, loopWindow);
        };
        const originalSend = audio.sendMdrMidi.bind(audio);
        audio.sendMdrMidi = (bytes, track, advance, scheduleAt) => {
          if ((bytes[0] & 0xf0) === 0x90 && bytes[2] > 0)
            state.sent.push({
              at: (scheduleAt ?? audio.context.currentTime) - state.startsAt,
              track,
              note: bytes[1],
            });
          originalSend(bytes, track, advance, scheduleAt);
        };
        const analysers = Object.fromEntries(
          ["opm", "midi"].map(bus => {
            const a = audio.context.createAnalyser();
            a.fftSize = 2048;
            audio.gains[bus].connect(a);
            return [bus, a];
          })
        );
        const data = new Float32Array(2048);
        state.timer = setInterval(() => {
          if (state.startsAt === undefined) return;
          const sample = {
            at: audio.context.currentTime - state.startsAt,
            hardware: audio.mdrPlayer?.getPlayAtMilliseconds() ?? null,
          };
          for (const bus of ["opm", "midi"]) {
            analysers[bus].getFloatTimeDomainData(data);
            let peak = 0;
            for (const value of data) peak = Math.max(peak, Math.abs(value));
            sample[bus] = peak;
          }
          state.samples.push(sample);
        }, 50);
        const info = await audio.playMdr(
          await binary(song.name),
          pdx ? await binary(pdx) : undefined,
          0,
          () => {},
          () => {
            state.ended = true;
          }
        );
        return {
          ...info,
          startsAt: state.startsAt,
          loopWindow: state.loopWindow,
          eventCount: state.eventCount,
        };
      },
      {
        song,
        sf: names.find(n => /\.sf2$/i.test(n)),
        pdx: names.find(n => n.toLowerCase() === song.pdx.toLowerCase()),
        profile: process.env.PERFORMANCE_PROFILE ?? "desktop",
      }
    );
    console.log(JSON.stringify({ phase: "started", name: song.name, ...info }));
    if (!info.loopWindow) throw new Error("No effective infinite loop window");
    const { startSeconds, endSeconds } = info.loopWindow;
    const period = endSeconds - startSeconds;
    const finish = song.loopEnd + song.period + 4;
    while (true) {
      const now = await page.evaluate(
        () => window.audio.context.currentTime - window.loopProbe.startsAt
      );
      if (now >= finish) break;
      await page.waitForTimeout(Math.min(10000, (finish - now) * 1000));
    }
    const capture = await page.evaluate(() => {
      const p = window.loopProbe;
      clearInterval(p.timer);
      const result = { samples: p.samples, sent: p.sent, ended: p.ended };
      window.audio.stop();
      return result;
    });
    const boundaries = [song.loopEnd, song.loopEnd + song.period].map(
      boundary => {
        const window = capture.samples.filter(
          s => s.at >= boundary - 1 && s.at <= boundary + 3
        );
        const after = capture.samples.filter(
          s => s.at >= boundary + 0.5 && s.at <= boundary + 3
        );
        const notes = capture.sent.filter(
          s => s.at >= boundary && s.at < boundary + 3
        );
        return {
          at: boundary,
          opmPeak: Math.max(0, ...after.map(s => s.opm)),
          midiPeak: Math.max(0, ...after.map(s => s.midi)),
          midiNoteOns: notes.length,
          firstNoteDelay: notes.length ? notes[0].at - boundary : null,
          samples: window.length,
          hardwareBefore: window[0]?.hardware,
          hardwareAfter: window.at(-1)?.hardware,
        };
      }
    );
    const initialOpmPeak = Math.max(
      0,
      ...capture.samples.filter(s => s.at >= 0 && s.at < 10).map(s => s.opm)
    );
    const result = {
      name: song.name,
      info,
      initialOpmPeak,
      observedSeconds: finish,
      boundaries,
      ended: capture.ended,
      errors,
      status:
        Math.abs(startSeconds - song.loopStart) < 0.01 &&
        Math.abs(endSeconds - song.loopEnd) < 0.01 &&
        !capture.ended &&
        !errors.length &&
        boundaries.every(
          b =>
            b.midiPeak > 0.0001 &&
            b.midiNoteOns > 0 &&
            (info.format === "MDR / GS MIDI" || b.opmPeak > 0.0001)
        )
          ? "pass"
          : "investigate",
    };
    await writeFile(
      path.join(out, encodeURIComponent(song.name) + ".json"),
      JSON.stringify(capture)
    );
    results.push(result);
    console.log(JSON.stringify({ phase: "complete", ...result }));
  } catch (error) {
    results.push({
      name: song.name,
      status: "error",
      error: error.message,
      errors,
    });
    console.log(JSON.stringify(results.at(-1)));
  } finally {
    await page.close();
    await writeFile(report, JSON.stringify(results, null, 2));
  }
}
try {
  await Promise.all(
    Array.from(
      { length: Number(process.env.LOOP_CONCURRENCY ?? 3) },
      async () => {
        while (next < selected.length) {
          const song = selected[next++];
          await run(song);
        }
      }
    )
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
