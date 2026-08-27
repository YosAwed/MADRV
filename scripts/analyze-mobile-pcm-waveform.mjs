import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const cpuThrottle = Number(process.env.PCM_WAVE_CPU_THROTTLE ?? "1");
const observationMs = Number(process.env.PCM_WAVE_OBSERVATION_MS ?? "12000");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const callbackWarnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("[MADRV audio]")) callbackWarnings.push(message.text());
  });
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
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/Downloads/DRA02.MDX", "/home/ubuntu/Downloads/DRA00.PDX"]);
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => document.body.textContent?.includes("PCM activity") && document.body.textContent.includes("Active · ch"), undefined, { timeout: 30_000 });
  await page.getByLabel("PCM / PDXの出力レベル").fill("100");
  await page.evaluate((duration) => {
    const context = window.__madrvContext;
    const pcmGain = window.__madrvGains?.[2];
    if (!context || !pcmGain) throw new Error("PCM gain node was not captured");
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    pcmGain.connect(analyser);
    const waveform = new Float32Array(analyser.fftSize);
    const samples = [];
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(waveform);
      let sumSquares = 0;
      let deltaSquares = 0;
      let maxAbs = 0;
      let nearZero = 0;
      for (let index = 0; index < waveform.length; index += 1) {
        const value = waveform[index] ?? 0;
        sumSquares += value * value;
        maxAbs = Math.max(maxAbs, Math.abs(value));
        if (Math.abs(value) < 0.0001) nearZero += 1;
        if (index > 0) {
          const delta = value - (waveform[index - 1] ?? 0);
          deltaSquares += delta * delta;
        }
      }
      samples.push({ rms: Math.sqrt(sumSquares / waveform.length), deltaRms: Math.sqrt(deltaSquares / (waveform.length - 1)), maxAbs, nearZeroRatio: nearZero / waveform.length });
    }, 64);
    window.__madrvPcmWaveMeasurement = { analyser, pcmGain, samples, timer };
    window.setTimeout(() => {
      window.clearInterval(timer);
      pcmGain.disconnect(analyser);
    }, duration);
  }, observationMs);
  await page.waitForTimeout(observationMs + 300);
  const stats = await page.evaluate(() => {
    const samples = window.__madrvPcmWaveMeasurement?.samples ?? [];
    const active = samples.filter((sample) => sample.rms > 0.001);
    const dropouts = samples.filter((sample) => sample.rms < 0.00005).length;
    const spikeRatio = active.length ? Math.max(...active.map((sample) => sample.deltaRms / Math.max(sample.rms, 0.000001))) : Infinity;
    return { sampleCount: samples.length, activeCount: active.length, dropouts, maxSpikeRatio: spikeRatio, maxAmplitude: Math.max(...samples.map((sample) => sample.maxAbs), 0) };
  });
  await page.getByLabel("停止").click();
  if (stats.activeCount < Math.max(10, Math.floor(stats.sampleCount * 0.6))) throw new Error(`PCM waveform did not remain active: ${JSON.stringify(stats)}`);
  if (stats.dropouts > 1) throw new Error(`PCM waveform contains repeated silent dropouts: ${JSON.stringify(stats)}`);
  if (callbackWarnings.length) throw new Error(`PCM callback deadline exceeded: ${callbackWarnings.join(" | ")}`);
  console.log(JSON.stringify({ cpuThrottle, observationMs, callbackWarnings, ...stats, pcmWaveformContinuous: true }));
} finally {
  await browser.close();
}
