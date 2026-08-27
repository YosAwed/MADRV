import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mode = process.env.PCM_VERIFY_MODE ?? "mobile";
const viewport = mode === "mobile" ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

function parseClock(value) {
  const match = value.match(/(\d+):(\d+)\.(\d+)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 : null;
}

try {
  const page = await browser.newPage({ viewport });
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
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/Downloads/DRA02.MDX", "/home/ubuntu/Downloads/DRA00.PDX"]);
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => document.body.textContent?.includes("PCM activity") && document.body.textContent.includes("Active · ch"), undefined, { timeout: 30_000 });
  const analyzePcmGain = async () => page.evaluate(async () => {
    const context = window.__madrvContext;
    const pcmGain = window.__madrvGains?.[2];
    if (!context || !pcmGain) throw new Error("PCM gain node was not captured");
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    pcmGain.connect(analyser);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(spectrum);
    pcmGain.disconnect(analyser);
    return spectrum.reduce((peak, value) => Math.max(peak, value), -Infinity);
  });
  const slider = page.getByLabel("PCM / PDXの出力レベル");
  await slider.fill("0");
  const mutedPeakDb = await analyzePcmGain();
  await slider.fill("100");
  const fullPeakDb = await analyzePcmGain();
  const firstPlayhead = parseClock(await page.getByLabel("MXDRV再生位置").textContent() ?? "");
  await page.waitForTimeout(12_000);
  const lastPlayhead = parseClock(await page.getByLabel("MXDRV再生位置").textContent() ?? "");
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  if (!(mutedPeakDb < -90 && fullPeakDb > -85)) throw new Error(`PCM gain did not affect audible branch: ${JSON.stringify({ mutedPeakDb, fullPeakDb })}`);
  if (firstPlayhead === null || lastPlayhead === null || lastPlayhead - firstPlayhead < 9) throw new Error(`MDX playhead stalled during PCM continuity test: ${JSON.stringify({ firstPlayhead, lastPlayhead })}`);
  if (errors.length) throw new Error(`Browser console errors: ${errors.join(" | ")}`);
  await page.getByLabel("停止").click();
  console.log(JSON.stringify({ mode, mutedPeakDb, fullPeakDb, firstPlayhead, lastPlayhead, playheadAdvance: lastPlayhead - firstPlayhead, pcmLevelApplied: true }));
} finally {
  await browser.close();
}
