import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const sourcePath = process.env.MDX_SOURCE ?? "/home/ubuntu/Downloads/BOM_01.MDX";
const pdxPath = process.env.MDX_PDX_PATH;
const observationMs = Number(process.env.MDX_PATH_OBSERVATION_MS ?? "12000");
const format = sourcePath.toLowerCase().endsWith(".mdr") ? "MDR" : "MDX";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleWarnings = [];
  let callbackLateCount = 0;
  page.on("console", message => {
    const text = message.text();
    if (text.includes("[MADRV audio]")) {
      callbackLateCount += 1;
      if (consoleWarnings.length < 8) consoleWarnings.push({ type: message.type(), text });
      return;
    }
    if (message.type() === "warning" || message.type() === "error") consoleWarnings.push({ type: message.type(), text });
  });
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.__madrvGains = [];
    window.__madrvProcessors = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(options) {
        super(options);
        const createGain = this.createGain.bind(this);
        const createScriptProcessor = this.createScriptProcessor.bind(this);
        this.createGain = () => {
          const gain = createGain();
          window.__madrvGains.push(gain);
          return gain;
        };
        this.createScriptProcessor = (...args) => {
          const processor = createScriptProcessor(...args);
          window.__madrvProcessors.push(processor);
          return processor;
        };
      }
    };
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(pdxPath ? [sourcePath, pdxPath] : sourcePath);
  await page.getByText(`${format} link analysis`).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(observationMs);
  const result = await page.evaluate(async () => {
    const gains = window.__madrvGains?.slice(1, 4);
    if (gains?.length !== 3) throw new Error(`Expected OPM, PCM, MIDI gains, found ${window.__madrvGains?.length ?? 0}`);
    const measure = async gain => {
      const analyser = gain.context.createAnalyser();
      analyser.fftSize = 8192;
      gain.connect(analyser);
      await new Promise(resolve => window.setTimeout(resolve, 300));
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      gain.disconnect(analyser);
      return samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    };
    const [opmPeak, pcmPeak, midiPeak] = await Promise.all(gains.map(measure));
    return {
      opmPeak,
      pcmPeak,
      midiPeak,
      gainValues: gains.map(gain => gain.gain.value),
      processorCount: window.__madrvProcessors?.length ?? 0,
      audioContextCount: window.__madrvGains?.[0]?.context ? 1 : 0,
      playhead: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "",
    };
  });
  await page.getByLabel("停止").click();
  if (result.processorCount !== 1 || result.opmPeak < 0.005 || result.pcmPeak > 0.001) {
    throw new Error(`Expected one mixed OPM/PCM renderer and no duplicate PCM path: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ sourcePath, format, observationMs, result, callbackLateCount, consoleWarnings, singleRendererPath: true }));
} finally {
  await browser.close();
}
