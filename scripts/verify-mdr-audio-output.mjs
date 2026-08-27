import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.__madrvGains = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(options) {
        super(options);
        const createGain = this.createGain.bind(this);
        this.createGain = () => {
          const gain = createGain();
          window.__madrvGains.push(gain);
          return gain;
        };
        window.__madrvContext = this;
      }
    };
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/upload/MEGALITH.MDR", "/home/ubuntu/upload/MEGALITH.PDX"]);
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(2_500);
  const result = await page.evaluate(async () => {
    const context = window.__madrvContext;
    const master = window.__madrvGains?.[0];
    if (!context || !master) throw new Error("MDR audio graph was not captured");
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    master.connect(analyser);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(spectrum);
    master.disconnect(analyser);
    const peakDb = spectrum.reduce((peak, value) => Math.max(peak, value), -Infinity);
    return {
      peakDb,
      timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent,
      bpm: document.querySelector('[aria-label="推定BPM"]')?.textContent,
      playhead: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent,
    };
  });
  if (!(result.peakDb > -85)) throw new Error(`MDR Web Audio output is silent: ${JSON.stringify(result)}`);
  if (result.timerB !== "0xC8" || result.bpm !== "87.2 BPM") throw new Error(`MDR tempo diagnostics mismatch: ${JSON.stringify(result)}`);
  await page.getByLabel("停止").click();
  console.log(JSON.stringify({ ...result, audioOutputActive: true }));
} finally {
  await browser.close();
}
