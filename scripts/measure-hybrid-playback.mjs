import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Real production UI + OPM/PCM renderer + built-in SoundFont under main-thread
// CPU throttling. Callback gaps indicate scheduling pressure, not a recording
// of physical output dropouts; CDP does not emulate a slower audio thread.
const root = path.resolve(process.argv[2] ?? "dist/public");
const source = process.env.MDR_SOURCE;
const sf = process.env.MDR_SF_PATH;
if (!source || !sf)
  throw new Error("Set MDR_SOURCE and MDR_SF_PATH; optionally MDR_PDX_PATH.");
const rate = Number(process.env.CPU_THROTTLE ?? 6);
const durationMs = Number(process.env.DURATION_MS ?? 15000);
const preset = process.env.PLAYBACK_PRESET ?? "low-latency";
const reportPath =
  process.env.HYBRID_REPORT ?? "/tmp/madrv-hybrid-performance.json";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  try {
    let file = path.join(
      root,
      decodeURIComponent(new URL(req.url, "http://localhost").pathname)
    );
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] ?? "application/octet-stream"
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [],
    warnings = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.text().includes("[MADRV audio]")) warnings.push(message.text());
  });
  await page.addInitScript(
    ({ preset }) => {
      localStorage.setItem("madrv-player.playback-tuning-preset-v1", preset);
      localStorage.setItem("madrv-player.keyboard-matrix-mode-v1", "tracks");
      window.__hybrid = {
        active: false,
        callbacks: [],
        longTasks: [],
        mutations: 0,
        peak: 0,
        buffers: [],
      };
      new PerformanceObserver(list => {
        if (window.__hybrid.active)
          window.__hybrid.longTasks.push(
            ...list.getEntries().map(e => e.duration)
          );
      }).observe({ type: "longtask", buffered: false });
      const createProcessor = AudioContext.prototype.createScriptProcessor;
      AudioContext.prototype.createScriptProcessor = function (...args) {
        window.__hybrid.buffers.push(args[0]);
        const node = createProcessor.apply(this, args);
        let previous;
        Object.defineProperty(node, "onaudioprocess", {
          set(callback) {
            node.addEventListener("audioprocess", event => {
              const start = performance.now();
              callback(event);
              const elapsed = performance.now() - start;
              if (window.__hybrid.active) {
                window.__hybrid.callbacks.push({
                  gap: previous === undefined ? 0 : start - previous,
                  render: elapsed,
                  budget:
                    (event.outputBuffer.length /
                      event.outputBuffer.sampleRate) *
                    1000,
                });
                for (let c = 0; c < event.outputBuffer.numberOfChannels; c++) {
                  const samples = event.outputBuffer.getChannelData(c);
                  // Sparse peak probe keeps the instrumentation outside the measured callback.
                  for (let i = 0; i < samples.length; i += 64)
                    window.__hybrid.peak = Math.max(
                      window.__hybrid.peak,
                      Math.abs(samples[i])
                    );
                }
              }
              previous = start;
            });
          },
        });
        return node;
      };
      addEventListener("DOMContentLoaded", () =>
        new MutationObserver(records => {
          if (window.__hybrid.active)
            window.__hybrid.mutations += records.length;
        }).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        })
      );
    },
    { preset }
  );
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://raw.githubusercontent.com/**", route =>
    route.abort()
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.goto(
    process.env.MADRV_E2E_BASE_URL ??
      `http://127.0.0.1:${server.address().port}`,
    {
      waitUntil: "networkidle",
    }
  );
  await page.locator('input[type="file"][accept*=".sf2"]').setInputFiles(sf);
  await page
    .getByTestId("playback-notice")
    .filter({ hasText: "GS MIDI出力用のSoundFontを読み込みました" })
    .waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  await page
    .locator('input[type="file"][accept*=".mdr"]')
    .setInputFiles([
      source,
      ...(process.env.MDR_PDX_PATH ? [process.env.MDR_PDX_PATH] : []),
    ]);
  await page
    .getByTestId("playback-notice")
    .filter({ hasText: "トラックを検出" })
    .waitFor();
  const loaded = await page.getByTestId("playback-notice").textContent();
  console.log(loaded);
  const verifyAdvisor = process.env.VERIFY_ADVISOR === "1";
  if (verifyAdvisor) {
    // Mock device enumeration only: no real external MIDI device is exercised.
    await page.evaluate(() => {
      navigator.requestMIDIAccess = async () => ({
        outputs: new Map([
          [
            "probe",
            { id: "probe", name: "Profile probe", send() {}, clear() {} },
          ],
        ]),
      });
    });
    const denseReason = "OPM／PCMと内蔵SoundFontの多数トラック";
    await page
      .getByTestId("playback-advisor")
      .filter({ hasText: denseReason })
      .waitFor();
    await page
      .getByRole("button", { name: "External MIDI", exact: true })
      .click();
    await page.waitForFunction(
      reason =>
        !document
          .querySelector('[data-testid="playback-advisor"]')
          ?.textContent.includes(reason),
      denseReason
    );
    await page.getByRole("button", { name: "SoundFont", exact: true }).click();
    await page
      .getByTestId("playback-advisor")
      .filter({ hasText: denseReason })
      .waitFor();
    await page
      .getByRole("button", { name: "Add current", exact: true })
      .click();
    if (!process.env.LIGHT_MDR_SOURCE)
      throw new Error(
        "VERIFY_ADVISOR requires LIGHT_MDR_SOURCE for the playlist transition."
      );
    await page
      .locator('input[type="file"][accept*=".mdr"]')
      .setInputFiles(process.env.LIGHT_MDR_SOURCE);
    await page
      .getByTestId("playback-notice")
      .filter({ hasText: "トラックを検出" })
      .waitFor();
    await page.getByTestId("playlist-entry-title-0").click();
  } else {
    await page.getByLabel("無限ループを切り替える").click();
    await page.getByRole("button", { name: "再生", exact: true }).click();
  }
  await page
    .getByTestId("playback-notice")
    .filter({ hasText: "再生中" })
    .waitFor({ timeout: 60000 })
    .catch(async error => {
      console.error(
        await page.getByTestId("playback-notice").textContent(),
        errors
      );
      throw error;
    });
  await page.waitForTimeout(3000);
  warnings.length = 0;
  await page.evaluate(() => {
    window.__hybrid.active = true;
  });
  await page.waitForTimeout(durationMs);
  const measurement = await page.evaluate(() => {
    window.__hybrid.active = false;
    return window.__hybrid;
  });
  const notice = await page.getByTestId("playback-notice").textContent();
  const advisor = await page.getByTestId("playback-advisor").textContent();
  await page.getByRole("button", { name: "停止", exact: true }).first().click();
  let advisorChecks;
  if (verifyAdvisor) {
    if (measurement.buffers.at(-1) !== 16384)
      throw new Error("Full-track playlist did not use stable buffer.");
    await page
      .getByTestId("playback-advisor")
      .getByRole("button", { name: "低遅延", exact: true })
      .click();
    const priorCount = measurement.buffers.length;
    await page.getByTestId("playlist-entry-title-0").click();
    await page.waitForFunction(
      count => window.__hybrid.buffers.length > count,
      priorCount
    );
    const manualBuffer = await page.evaluate(() =>
      window.__hybrid.buffers.at(-1)
    );
    await page
      .getByRole("button", { name: "停止", exact: true })
      .first()
      .click();
    if (manualBuffer !== 2048)
      throw new Error("Manual low-latency selection was overridden.");
    advisorChecks = {
      destinationSwitch: true,
      playlistBuffer: 16384,
      manualBuffer,
    };
  }
  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;
  const report = {
    root,
    baseUrl: process.env.MADRV_E2E_BASE_URL,
    source,
    rate,
    durationMs,
    preset,
    loaded,
    notice,
    advisor,
    advisorChecks,
    callbacks: measurement.callbacks.length,
    bufferBudgetMs: measurement.callbacks[0]?.budget,
    callbackGapP95Ms: percentile(
      measurement.callbacks.map(c => c.gap),
      0.95
    ),
    callbackGapMaxMs: Math.max(0, ...measurement.callbacks.map(c => c.gap)),
    callbackRenderP95Ms: percentile(
      measurement.callbacks.map(c => c.render),
      0.95
    ),
    lateCallbacks: measurement.callbacks.filter(c => c.gap > c.budget * 1.8)
      .length,
    longTasks: measurement.longTasks.length,
    longTaskTotalMs: measurement.longTasks.reduce((sum, ms) => sum + ms, 0),
    mutations: measurement.mutations,
    peak: measurement.peak,
    warnings,
    errors,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (errors.length || !measurement.callbacks.length || !measurement.peak)
    throw new Error("Hybrid rendering failed; see report.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
