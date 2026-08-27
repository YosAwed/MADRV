import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const sourceUrl = process.env.MADRV_SESSION_MDR_URL ?? "https://drive.google.com/file/d/1du96-9og-KQ9Cx8S59r7H__gllfzsWkQ/view?usp=share_link";
const soundFontUrl = process.env.MADRV_SESSION_SF_URL ?? "https://raw.githubusercontent.com/JustEnoughLinuxOS/generaluser-gs/main/GeneralUser%20GS%20v1.471.sf2";
const soundFontFile = process.env.MADRV_SESSION_SF_FILE;
const durationMs = Number(process.env.MADRV_CALIBRATION_DURATION_MS ?? "45000");
const forcedAudioSampleRate = Number(process.env.MADRV_FORCE_AUDIO_SAMPLE_RATE ?? "0");
const browserUserAgent = process.env.MADRV_BROWSER_USER_AGENT;
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

function parseMilliseconds(value) {
  const match = value.trim().match(/^(\d+):(\d{2})\.(\d{3})$/);
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(match[3]) : null;
}

function parseSignedMilliseconds(value) {
  const match = value.match(/([+-]?\d+)\s*ms/i);
  return match ? Number(match[1]) : null;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...(browserUserAgent ? { userAgent: browserUserAgent } : {}) });
  if (Number.isFinite(forcedAudioSampleRate) && forcedAudioSampleRate > 0) {
    await page.addInitScript((sampleRate) => {
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(options = {}) {
          super({ ...options, sampleRate });
        }
      };
    }, forcedAudioSampleRate);
  }
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByRole("button", { name: "REMOTE URL" }).click();
  await page.getByPlaceholder(/song\.mdr/).fill(sourceUrl);
  await page.getByRole("button", { name: "Load source" }).click();
  await page.getByRole("heading", { name: /OUTRUN - SPLASH WAVE/i }).waitFor({ state: "visible", timeout: 45_000 });
  if (soundFontFile) {
    await page.locator('input[type="file"][accept*=".sf2"]').setInputFiles(soundFontFile);
    await page.getByRole("button", { name: /OmegaGMGS2\.sf2|SoundFont load failed/i }).waitFor({ state: "visible", timeout: 90_000 });
  } else {
    const soundFontInput = page.getByPlaceholder(/gs\.sf2/);
    await soundFontInput.fill(soundFontUrl);
    await soundFontInput.locator("xpath=following-sibling::button[1]").click();
    await page.getByTestId("remote-soundfont-progress").getByText("SoundFont ready").waitFor({ state: "visible", timeout: 90_000 });
  }
  await page.getByRole("button", { name: "再生" }).click();
  await page.waitForFunction(() => /[+-]?\d+\s*ms/i.test(document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? ""), undefined, { timeout: 30_000 });
  const startedAt = performance.now();
  const samples = [];
  while (performance.now() - startedAt < durationMs) {
    const data = await page.evaluate(() => ({ position: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "", delta: document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? "" }));
    samples.push({ elapsedMs: performance.now() - startedAt, opmMs: parseMilliseconds(data.position), deltaMs: parseSignedMilliseconds(data.delta) });
    await page.waitForTimeout(1000);
  }
  await page.getByLabel("停止").click();
  const valid = samples.filter(sample => sample.opmMs !== null && sample.deltaMs !== null);
  if (valid.length < 10) throw new Error(`同期値が不足しています: ${JSON.stringify(samples)}`);
  const maxAbsoluteDeltaMs = Math.max(...valid.map(sample => Math.abs(sample.deltaMs)));
  const settled = valid.filter(sample => sample.elapsedMs >= 12_000);
  const first = settled[0] ?? valid[0];
  const last = settled.at(-1) ?? valid.at(-1);
  const driftMs = last.deltaMs - first.deltaMs;
  // The ScriptProcessor playhead advances one audio block at a time, so short
  // event-to-event readings can move by one block. Reject sustained growth,
  // not that bounded block jitter.
  // Larger ScriptProcessor blocks intentionally introduce a fixed phase offset
  // for large SoundFonts. Reject cumulative growth, not that bounded latency.
  if (maxAbsoluteDeltaMs > 350 || Math.abs(driftMs) > 120) throw new Error(`OPM/GS MIDI drift regression: ${JSON.stringify({ maxAbsoluteDeltaMs, driftMs, valid })}`);
  console.log(JSON.stringify({ sourceUrl, soundFontUrl: soundFontFile ?? soundFontUrl, forcedAudioSampleRate: forcedAudioSampleRate || undefined, browserUserAgent, validSamples: valid.length, settledSamples: settled.length, maxAbsoluteDeltaMs, driftMs, first, last, errors }));
} finally {
  await browser.close();
}
