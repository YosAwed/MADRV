import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const observationMs = Number(process.env.MDX_TEMPO_OBSERVATION_MS ?? "12000");
const forcedSampleRate = Number(process.env.MDX_TEMPO_SAMPLE_RATE ?? "0");
const expectedTimerB = Number(process.env.MDX_EXPECTED_TIMER_B ?? "224");
const expectedAudioSampleRate = Number(process.env.MDX_EXPECTED_AUDIO_SAMPLE_RATE ?? "48000");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

function parseClock(value) {
  const match = value?.match(/(\d{2}):(\d{2})\.(\d{3})/);
  if (!match) throw new Error(`MXDRV playhead is not a timestamp: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000;
}

async function measure(viewport, profile) {
  const page = await browser.newPage({ viewport });
  try {
    if (Number.isFinite(forcedSampleRate) && forcedSampleRate > 0) {
      await page.addInitScript((sampleRate) => {
        const NativeAudioContext = window.AudioContext;
        class ForcedRateAudioContext extends NativeAudioContext {
          constructor(options) { super({ ...(options ?? {}), sampleRate }); }
        }
        window.AudioContext = ForcedRateAudioContext;
      }, forcedSampleRate);
    }
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "LOCAL FILE" }).click();
    await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/Downloads/DRA02.MDX", "/home/ubuntu/Downloads/DRA00.PDX"]);
    await page.getByRole("button", { name: "再生" }).click();
    const playhead = page.getByLabel("MXDRV再生位置");
    await playhead.filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 15_000 });
    const timerB = page.getByLabel("Timer-B値");
    await timerB.filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 15_000 });
    const estimatedBpm = page.getByLabel("推定BPM");
    await estimatedBpm.filter({ hasNotText: "— BPM" }).waitFor({ state: "visible", timeout: 15_000 });
    const sampleClock = await page.getByLabel("再生クロック").textContent();
    const renderedSampleRate = Number(sampleClock?.match(/([\d.]+)\s*kHz/)?.[1]) * 1000;
    if (!Number.isFinite(renderedSampleRate)) throw new Error(`AudioContext sample clock is not readable: ${sampleClock}`);
    if (forcedSampleRate > 0 && Math.abs(renderedSampleRate - forcedSampleRate) > 10) throw new Error(`AudioContext sample clock mismatch: expected ${forcedSampleRate}, received ${renderedSampleRate}`);
    if (forcedSampleRate === 0 && Math.abs(renderedSampleRate - expectedAudioSampleRate) > 10) throw new Error(`MADRV AudioContext must use ${expectedAudioSampleRate} Hz, received ${renderedSampleRate}`);
    const start = parseClock(await playhead.textContent());
    const wallStart = performance.now();
    await page.waitForTimeout(observationMs);
    const end = parseClock(await playhead.textContent());
    const elapsed = (performance.now() - wallStart) / 1000;
    const coreElapsed = end - start;
    const ratio = coreElapsed / elapsed;
    const liveTimerB = await timerB.textContent();
    const timerMatch = liveTimerB?.match(/^0x([0-9A-F]{2})$/);
    const timerValue = timerMatch ? Number.parseInt(timerMatch[1], 16) : Number.NaN;
    if (timerValue !== expectedTimerB) throw new Error(`Unexpected Timer-B: expected 0x${expectedTimerB.toString(16).toUpperCase()}, received ${liveTimerB}`);
    const displayedBpm = Number((await estimatedBpm.textContent())?.match(/([\d.]+)\s*BPM/)?.[1]);
    const expectedBpm = 60_000_000 / (256 * (256 - expectedTimerB) * 48);
    if (!Number.isFinite(displayedBpm) || Math.abs(displayedBpm - expectedBpm) > 0.2) throw new Error(`Timer-B BPM mismatch: expected ${expectedBpm}, received ${displayedBpm}`);
    if (Math.abs(ratio - 1) > 0.03) throw new Error(`${profile} MDX clock drift exceeds 3%: ${ratio}`);
    await page.getByLabel("停止").click();
    return { profile, sampleClock, timerB: liveTimerB, expectedBpm, displayedBpm, elapsed, coreElapsed, ratio, deltaSeconds: coreElapsed - elapsed, pitchClockAligned: true };
  } finally {
    await page.close();
  }
}

try {
  const requested = process.env.MDX_TEMPO_PROFILE ?? "both";
  const desktop = requested === "mobile" ? undefined : await measure({ width: 1280, height: 900 }, "desktop");
  const mobile = requested === "desktop" ? undefined : await measure({ width: 375, height: 812 }, "mobile");
  console.log(JSON.stringify({ observationMs, forcedSampleRate: forcedSampleRate || undefined, desktop, mobile }));
} finally {
  await browser.close();
}
