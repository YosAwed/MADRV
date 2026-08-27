import { chromium } from "playwright-core";
import { basename } from "node:path";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const requestedSampleRate = Number(process.env.MDR_SYNC_SAMPLE_RATE ?? "44100");
const sourcePath = process.env.MDR_SYNC_SOURCE ?? "/home/ubuntu/upload/HECT_GS2.MDR";
const pdxPath = process.env.MDR_SYNC_PDX;
const observationCount = Number(process.env.MDR_SYNC_OBSERVATIONS ?? "30");
const observationIntervalMs = Number(process.env.MDR_SYNC_INTERVAL_MS ?? "300");
const expectedTimerB = process.env.MDR_EXPECT_TIMER_B;
const mobileViewport = process.env.MDR_SYNC_MOBILE === "1";
if (!Number.isFinite(requestedSampleRate) || requestedSampleRate < 8_000 || requestedSampleRate > 192_000) throw new Error("MDR_SYNC_SAMPLE_RATE must be a valid AudioContext sample rate.");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: mobileViewport ? { width: 375, height: 812 } : { width: 1280, height: 900 } });
  await page.addInitScript((sampleRate) => {
    const NativeAudioContext = window.AudioContext;
    class FixedRateAudioContext extends NativeAudioContext {
      constructor(options) { super({ ...(options ?? {}), sampleRate }); }
    }
    window.AudioContext = FixedRateAudioContext;
  }, requestedSampleRate);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(pdxPath ? [sourcePath, pdxPath] : sourcePath);
  await page.getByRole("heading", { name: basename(sourcePath).toUpperCase() }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "再生" }).click();
  const audioClock = `${(requestedSampleRate / 1000).toFixed(1)} kHz`;
  await page.getByLabel("AudioContext clock").getByText(audioClock).waitFor({ state: "visible", timeout: 15_000 });
  if (expectedTimerB) {
    const timerText = await page.getByLabel("Timer-B値").textContent();
    if (timerText?.toLowerCase() !== expectedTimerB.toLowerCase()) throw new Error(`Timer-B mismatch: expected ${expectedTimerB}, got ${timerText}`);
  }
  await page.waitForFunction(() => document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent?.includes("ms"), undefined, { timeout: 20_000 });
  const deltas = [];
  for (let index = 0; index < observationCount; index += 1) {
    await page.waitForTimeout(observationIntervalMs);
    const text = await page.getByLabel("GS MIDI同期差").textContent();
    const value = Number.parseFloat((text ?? "").replace("ms", ""));
    if (Number.isFinite(value)) deltas.push(value);
  }
  await page.getByLabel("停止").click();
  if (!deltas.length) throw new Error("No GS MIDI synchronization diagnostics were produced.");
  const greatestAbsoluteDelta = Math.max(...deltas.map((value) => Math.abs(value)));
  if (greatestAbsoluteDelta > 250) throw new Error(`GS MIDI drift exceeded the fixed-core tolerance at ${audioClock}: ${JSON.stringify(deltas)}`);
  console.log(JSON.stringify({ sourcePath, audioClock, mobileViewport, deltas, greatestAbsoluteDelta, synchronizedToMxdrvCore: true }));
} finally {
  await browser.close();
}
