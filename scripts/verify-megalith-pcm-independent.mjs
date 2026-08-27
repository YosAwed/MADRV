import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const soundFontPath = process.env.SOUND_FONT_PATH;
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
      }
    };
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (soundFontPath) {
    await page.locator('input[accept=".sf2,.sf3,.dls"]').setInputFiles(soundFontPath);
    await page.getByText(new RegExp(soundFontPath.split("/").at(-1)?.replace(".", "\\.") ?? "SoundFont")).waitFor({ state: "visible", timeout: 120_000 });
  }
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/upload/MEGALITH.MDR", "/home/ubuntu/upload/MEGALITH.PDX"]);
  await page.getByLabel("PCM / PDXの出力レベル").fill("100");
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(4_000);
  const measure = async () => page.evaluate(async () => {
    const gains = window.__madrvGains?.slice(1, 4);
    if (gains?.length !== 3) throw new Error(`Expected OPM, PCM, MIDI gains, found ${window.__madrvGains?.length ?? 0}`);
    const peaks = await Promise.all(gains.map(async (gain) => {
      const analyser = gain.context.createAnalyser();
      analyser.fftSize = 4096;
      gain.connect(analyser);
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      gain.disconnect(analyser);
      return samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    }));
    return { peaks, gainValues: gains.map((gain) => gain.gain.value) };
  });
  const before = await measure();
  await page.getByLabel("PCM / PDXの出力レベル").fill("0");
  await page.waitForTimeout(300);
  const after = await measure();
  await page.getByLabel("停止").click();
  const [opmBefore, pcmBefore, midiBefore] = before.gainValues;
  const [opmAfter, pcmAfter, midiAfter] = after.gainValues;
  if (pcmBefore <= 0 || pcmAfter !== 0) throw new Error(`PCM gain did not attenuate independently: ${JSON.stringify({ before, after })}`);
  if (opmBefore !== opmAfter) throw new Error(`OPM gain changed with PCM-only level: ${JSON.stringify({ before, after })}`);
  if (midiBefore !== midiAfter) throw new Error(`SoundFont MIDI gain changed with PCM-only level: ${JSON.stringify({ before, after })}`);
  console.log(JSON.stringify({ before, after, pcmIndependent: true, soundFontIndependent: true }));
} finally {
  await browser.close();
}
