import { chromium } from "playwright-core";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const out = process.env.USE_BUILD ?? "/tmp/madrv-portamento-build";
await mkdir(out, { recursive: true });
if (!process.env.USE_BUILD)
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
    const u = new URL(req.url, "http://localhost");
    let f;
    if (u.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<script type="module">import {SignalDeckAudio} from "/engine.js";window.SignalDeckAudio=SignalDeckAudio;</script>'
      );
      return;
    }
    if (u.pathname === "/song")
      f = path.resolve(
        process.env.PORTAMENTO_SOURCE ??
          "scripts/fixtures/welcome-racer-portamento.mdr"
      );
    else if (u.pathname === "/sf")
      f = process.env.MDR_SF_PATH ?? "/Users/awed/MDRSAMPLE/Roland_SC-55.sf2";
    else if (u.pathname.startsWith("/manus-storage/"))
      f = path.join(process.cwd(), "client/public", u.pathname);
    else f = path.join(out, path.basename(u.pathname));
    res.setHeader(
      "Content-Type",
      /\.m?js$/.test(f)
        ? "text/javascript"
        : f.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream"
    );
    res.end(await readFile(f));
  } catch (e) {
    res.statusCode = 404;
    res.end(String(e));
  }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.SignalDeckAudio);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: Number(process.env.CPU_THROTTLE ?? 1),
  });
  const result = await page.evaluate(
    async ({ profile, shiftMs, duration, restart }) => {
      const audio = new window.SignalDeckAudio();
      audio.setPerformanceProfile(profile);
      await audio.loadSoundFontData(await (await fetch("/sf")).arrayBuffer());
      const log = [],
        scheduled = [];
      let startsAt = 0;
      const send = audio.sendMdrMidi.bind(audio),
        queue = audio.queueSoundFontMdrMidi.bind(audio),
        timeline = audio.startMdrMidiTimeline.bind(audio);
      audio.startMdrMidiTimeline = (events, start, loop) => {
        startsAt = start;
        return timeline(events, start, loop);
      };
      audio.queueSoundFontMdrMidi = (bytes, track, target, ...rest) => {
        if (
          bytes[0] === 224 &&
          bytes[1] === 0 &&
          bytes[2] === 64 &&
          target - startsAt > 3
        )
          target -= shiftMs / 1000;
        if ((bytes[0] & 15) === 0)
          scheduled.push({
            target: target - startsAt,
            at: audio.context.currentTime - startsAt,
            bytes,
          });
        return queue(bytes, track, target, ...rest);
      };
      audio.sendMdrMidi = (bytes, track, advance, time) => {
        if ((bytes[0] & 15) === 0)
          log.push({ at: audio.context.currentTime - startsAt, time, bytes });
        return send(bytes, track, advance, time);
      };
      const info = await audio.playMdr(
        await (await fetch("/song")).arrayBuffer(),
        undefined,
        0,
        () => {},
        () => {}
      );
      if (restart) {
        await new Promise(r => setTimeout(r, 3100));
        audio.stop();
        await audio.playMdr(await (await fetch("/song")).arrayBuffer(), undefined, 0, () => {}, () => {});
      }
      const checkpoints = [];
      let waited = 0;
      for (const at of [6000, 19000, 32000].filter(at => at <= duration)) {
        await new Promise(r => setTimeout(r, at - waited));
        waited = at;
        const state = await audio.gsSynth.getSnapshot();
        checkpoints.push({
          atMs: at,
          pitchWheel: state.midiChannels[0].midiParameters.pitchWheel,
        });
      }
      if (waited < duration)
        await new Promise(r => setTimeout(r, duration - waited));
      const snapshot = await audio.gsSynth.getSnapshot();
      audio.stop();
      return {
        info,
        checkpoints,
        log,
        scheduled,
        snapshotKeys: Object.keys(snapshot),
        snapshot,
      };
    },
    {
      profile: process.env.PERFORMANCE_PROFILE ?? "desktop",
      shiftMs: Number(process.env.SHIFT_CENTER_MS ?? 0),
      duration: Number(process.env.DURATION_MS ?? 6000),
      restart: process.env.RESTART_DURING_BEND === "1",
    }
  );
  await writeFile(
    process.env.PORTAMENTO_REPORT ?? "/tmp/madrv-portamento-result.json",
    JSON.stringify(result, null, 2)
  );
  const expected = Number(process.env.EXPECTED_BEND ?? 8192);
  if (
    result.snapshot.midiChannels[0].midiParameters.pitchWheel !== expected ||
    result.checkpoints.some(c => c.pitchWheel !== expected)
  )
    throw new Error(
      "Pitch bend did not return to expected state: " +
        JSON.stringify(result.checkpoints)
    );
  console.log(
    JSON.stringify({
      info: result.info,
      checkpoints: result.checkpoints,
      bend: result.snapshot.midiChannels[0].midiParameters.pitchWheel,
      snapshotKeys: result.snapshotKeys,
      events: result.log.filter(e => e.at > 3.2 && e.at < 3.8),
    })
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
