import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mdrPath = process.env.MADRV_MDR_PATH ?? "/home/ubuntu/upload/PRIN_GS.MDR";
const soundFontPath = process.env.MADRV_SF_PATH ?? "/home/ubuntu/webdev-static-assets/GeneralUser-GS-v1.471.sf2";
const durationMs = Number(process.env.MADRV_DRIFT_DURATION_MS ?? "125000");
const intervalMs = Number(process.env.MADRV_DRIFT_INTERVAL_MS ?? "1000");
const maxDriftMs = Number(process.env.MADRV_MAX_DRIFT_MS ?? "120");
const soundFontName = soundFontPath.split(/[\\/]/).at(-1) ?? soundFontPath;

function parseSignedMilliseconds(value) {
  const match = value.match(/([+-]?\d+)\s*ms/i);
  return match ? Number(match[1]) : null;
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".sf2"]').setInputFiles(soundFontPath);
  await page.getByRole("button", { name: soundFontName, exact: true }).waitFor({ state: "visible", timeout: 90_000 });
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(mdrPath);
  await page.getByLabel("無限ループを切り替える").click();
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => /[+-]?\d+\s*ms/i.test(document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? ""), undefined, { timeout: 30_000 });
  const startedAt = await page.evaluate(() => performance.now());
  const samples = [];
  while (true) {
    const sample = await page.evaluate(() => ({
      elapsedMs: performance.now(),
      position: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "",
      delta: document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? "",
      timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent ?? "",
    }));
    const deltaMs = parseSignedMilliseconds(sample.delta);
    if (deltaMs !== null) samples.push({ elapsedMs: sample.elapsedMs - startedAt, deltaMs, position: sample.position, timerB: sample.timerB });
    if (sample.elapsedMs - startedAt >= durationMs) break;
    await page.waitForTimeout(intervalMs);
  }
  await page.getByLabel("停止").click();
  if (samples.length < 3) throw new Error(`Insufficient OPM/MIDI sync samples: ${JSON.stringify(samples)}`);
  const first = samples[0];
  const last = samples.at(-1);
  const driftMs = last.deltaMs - first.deltaMs;
  const rangeMs = Math.max(...samples.map(sample => sample.deltaMs)) - Math.min(...samples.map(sample => sample.deltaMs));
  if (Math.abs(driftMs) > maxDriftMs || rangeMs > maxDriftMs * 2) {
    throw new Error(`OPM/MIDI phase drift exceeded tolerance: ${JSON.stringify({ driftMs, rangeMs, maxDriftMs, samples })}`);
  }
  if (consoleErrors.length) throw new Error(`OPM/MIDI drift regression logged console errors: ${JSON.stringify(consoleErrors)}`);
  console.log(JSON.stringify({ mdrPath, durationMs, intervalMs, sampleCount: samples.length, first, last, driftMs, rangeMs, consoleErrors, phaseStable: true }));
} finally {
  await browser.close();
}
