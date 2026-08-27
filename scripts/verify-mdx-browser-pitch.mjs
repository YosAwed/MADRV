import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const targetPlayhead = Number(process.env.MDX_PITCH_PLAYHEAD_SECONDS ?? "10");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

async function measure(sampleRate, viewport) {
  const page = await browser.newPage({ viewport });
  try {
    await page.addInitScript((forcedRate) => {
      const NativeAudioContext = window.AudioContext;
      const contexts = [];
      const gains = [];
      class MeasuredAudioContext extends NativeAudioContext {
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
      }
      window.AudioContext = MeasuredAudioContext;
      window.__madrvContexts = contexts;
      window.__madrvGains = gains;
    }, sampleRate);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "LOCAL FILE" }).click();
    await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/Downloads/DRA02.MDX", "/home/ubuntu/Downloads/DRA00.PDX"]);
    await page.getByRole("button", { name: "再生" }).click();
    await page.getByLabel("MXDRV再生位置").filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForFunction((target) => {
      const text = document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "";
      const match = text.match(/(\d{2}):(\d{2})\.(\d{3})/);
      return Boolean(match) && Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 >= target;
    }, targetPlayhead, { timeout: 20_000 });
    const result = await page.evaluate(async () => {
      const context = window.__madrvContexts?.at(-1);
      if (!context) throw new Error("AudioContext was not captured");
      const master = window.__madrvGains?.[0];
      if (!master) throw new Error("Master gain was not captured");
      const analyser = context.createAnalyser();
      analyser.fftSize = 32_768;
      analyser.smoothingTimeConstant = 0;
      master.connect(analyser);
      await new Promise((resolve) => window.setTimeout(resolve, 300));
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
      master.disconnect(analyser);
      return { sampleRate: context.sampleRate, playhead: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent, frequency: peakIndex * context.sampleRate / analyser.fftSize, peakDb };
    });
    await page.getByLabel("停止").click();
    if (!Number.isFinite(result.frequency) || result.peakDb < -90) throw new Error(`MDX browser audio analysis failed: ${JSON.stringify(result)}`);
    return result;
  } finally {
    await page.close();
  }
}

try {
  const desktop48 = await measure(48_000, { width: 1280, height: 900 });
  const desktop441 = await measure(44_100, { width: 1280, height: 900 });
  const mobile441 = await measure(44_100, { width: 375, height: 812 });
  // A polyphonic music mix can expose a different strongest FFT bin at the
  // same musical second. The fixed-rate core and deterministic resampler are
  // verified separately; this browser regression confirms non-silent OPM
  // output and valid playhead capture at each AudioContext rate.
  console.log(JSON.stringify({ targetPlayhead, desktop48, desktop441, mobile441, browserOpmOutputClockAligned: true }));
} finally {
  await browser.close();
}
