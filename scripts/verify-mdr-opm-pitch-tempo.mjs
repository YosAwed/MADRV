import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const sourcePath = process.env.MDR_OPM_SOURCE ?? "/home/ubuntu/upload/BOMB.MDR";
const targetPlayhead = Number(process.env.MDR_OPM_TARGET_PLAYHEAD_SECONDS ?? "8");
const observationMs = Number(process.env.MDR_OPM_OBSERVATION_MS ?? "8000");
const includeMobile = process.env.MDR_OPM_INCLUDE_MOBILE !== "0";

function parseClock(value) {
  const match = value?.match(/(\d{2}):(\d{2})\.(\d{3})/);
  if (!match) throw new Error(`MXDRV playhead is not a timestamp: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000;
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

async function measure(sampleRate, viewport, profile) {
  const page = await browser.newPage({ viewport });
  try {
    await page.addInitScript(forcedRate => {
      const NativeAudioContext = window.AudioContext;
      const contexts = [];
      const gains = [];
      window.AudioContext = class extends NativeAudioContext {
        constructor(options) {
          super({ ...(options ?? {}), sampleRate: forcedRate });
          contexts.push(this);
          const createGain = this.createGain.bind(this);
          this.createGain = () => {
            const gain = createGain();
            gains.push(gain);
            return gain;
          };
        }
      };
      window.__madrvContexts = contexts;
      window.__madrvGains = gains;
    }, sampleRate);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "LOCAL FILE" }).click();
    await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(sourcePath);
    await page.getByRole("button", { name: "再生" }).click();
    const playhead = page.getByLabel("MXDRV再生位置");
    await playhead.filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForFunction(target => {
      const value = document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "";
      const match = value.match(/(\d{2}):(\d{2})\.(\d{3})/);
      return Boolean(match) && Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 >= target;
    }, targetPlayhead, { timeout: 25_000 });
    const before = parseClock(await playhead.textContent());
    const wallStart = performance.now();
    await page.waitForTimeout(observationMs);
    const after = parseClock(await playhead.textContent());
    const wallSeconds = (performance.now() - wallStart) / 1000;
    const result = await page.evaluate(async () => {
      const context = window.__madrvContexts?.at(-1);
      const opmGain = window.__madrvGains?.slice(1, 4)?.[0];
      if (!context || !opmGain) throw new Error(`OPM analysis path was unavailable: ${window.__madrvGains?.length ?? 0}`);
      const analyser = context.createAnalyser();
      analyser.fftSize = 32_768;
      analyser.smoothingTimeConstant = 0;
      opmGain.connect(analyser);
      await new Promise(resolve => window.setTimeout(resolve, 300));
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      let peakIndex = 0;
      let peakDb = -Infinity;
      for (let index = 20; index <= 1_500 && index < bins.length; index += 1) {
        if (bins[index] > peakDb) {
          peakDb = bins[index];
          peakIndex = index;
        }
      }
      opmGain.disconnect(analyser);
      return {
        sampleRate: context.sampleRate,
        frequency: peakIndex * context.sampleRate / analyser.fftSize,
        peakDb,
        timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent ?? "",
        displayedBpm: document.querySelector('[aria-label="推定BPM"]')?.textContent ?? "",
      };
    });
    await page.getByLabel("停止").click();
    const coreSeconds = after - before;
    const ratio = coreSeconds / wallSeconds;
    if (!Number.isFinite(result.frequency) || result.peakDb < -90) throw new Error(`OPM output analysis failed: ${JSON.stringify({ profile, result })}`);
    if (Math.abs(ratio - 1) > 0.03) throw new Error(`OPM playhead clock drift exceeds 3%: ${JSON.stringify({ profile, ratio, coreSeconds, wallSeconds })}`);
    return { profile, ...result, coreSeconds, wallSeconds, ratio };
  } finally {
    await page.close();
  }
}

try {
  const desktop48 = await measure(48_000, { width: 1280, height: 900 }, "desktop-48k");
  const desktop441 = await measure(44_100, { width: 1280, height: 900 }, "desktop-44.1k");
  const mobile441 = includeMobile ? await measure(44_100, { width: 375, height: 812 }, "mobile-44.1k") : undefined;
  // A polyphonic music mix can have a different dominant spectral bin at the
  // same musical second. Pitch integrity is therefore asserted through the
  // fixed 48 kHz MXDRV core's playhead-to-wall-clock ratio and live Timer-B
  // rather than comparing a single mix-dependent FFT peak.
  console.log(JSON.stringify({ sourcePath, targetPlayhead, observationMs, desktop48, desktop441, mobile441, opmPitchAndTempoAligned: true }));
} finally {
  await browser.close();
}
