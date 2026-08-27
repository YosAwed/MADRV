import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "https://madrvplay-elrop8px.manus.space";
const sessionId = process.env.MADRV_SESSION_ID ?? "rVxAtutx";
const durationMs = Number(process.env.MADRV_DRIFT_DURATION_MS ?? "45000");
const intervalMs = Number(process.env.MADRV_DRIFT_INTERVAL_MS ?? "1000");
const soundFontReadyTimeoutMs = Number(process.env.MADRV_SOUNDFONT_READY_TIMEOUT_MS ?? "360000");
const outputPath = process.env.MADRV_DRIFT_OUTPUT ?? "/home/ubuntu/madrv-player-web/test-artifacts/session-rVxAtutx-drift.json";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

function parseTimeMilliseconds(value) {
  const match = value.trim().match(/^(\d+):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  return (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(match[3]);
}

function parseSignedMilliseconds(value) {
  const match = value.match(/([+-]?\d+)\s*ms/i);
  return match ? Number(match[1]) : null;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${baseUrl}/?s=${sessionId}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByPlaceholder(/song\.mdr/).waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("remote-soundfont-progress").getByText("SoundFont ready").waitFor({ state: "visible", timeout: soundFontReadyTimeoutMs });
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("MXDRV再生位置").filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => /[+-]?\d+\s*ms/i.test(document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? ""), undefined, { timeout: 30_000 });

  const startedAt = performance.now();
  const samples = [];
  while (performance.now() - startedAt < durationMs) {
    const sample = await page.evaluate(() => ({
      capturedAt: performance.now(),
      position: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "",
      delta: document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? "",
      timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent ?? "",
    }));
    samples.push({ elapsedMs: sample.capturedAt - startedAt, opmMilliseconds: parseTimeMilliseconds(sample.position), gsMinusOpmMilliseconds: parseSignedMilliseconds(sample.delta), timerB: sample.timerB.trim() });
    await page.waitForTimeout(intervalMs);
  }
  await page.getByLabel("停止").click();
  const valid = samples.filter(sample => sample.opmMilliseconds !== null && sample.gsMinusOpmMilliseconds !== null);
  if (valid.length < 2) throw new Error(`同期診断値を十分に取得できませんでした: ${JSON.stringify(samples)}`);
  const first = valid[0];
  const last = valid.at(-1);
  const driftMs = last.gsMinusOpmMilliseconds - first.gsMinusOpmMilliseconds;
  const elapsedSeconds = Math.max(0.001, (last.elapsedMs - first.elapsedMs) / 1000);
  const driftPerMinuteMs = driftMs / elapsedSeconds * 60;
  const report = { baseUrl, sessionId, durationMs, intervalMs, samples, validSamples: valid.length, driftMs, elapsedSeconds, driftPerMinuteMs, consoleErrors };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
