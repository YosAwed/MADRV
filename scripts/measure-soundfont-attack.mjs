import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const soundFontPath = process.env.SOUND_FONT_PATH ?? "/home/ubuntu/upload/OmegaGMGS2.sf2";
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
  await page.locator('input[accept=".sf2,.sf3,.dls"]').setInputFiles(soundFontPath);
  await page.getByText(/OmegaGMGS2\.sf2/).waitFor({ state: "visible", timeout: 120_000 });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/upload/MEGALITH.MDR", "/home/ubuntu/upload/MEGALITH.PDX"]);
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 30_000 });
  const measured = await page.evaluate(async () => {
    const gains = window.__madrvGains?.slice(1, 4);
    if (gains?.length !== 3) throw new Error(`Expected OPM, PCM, and MIDI gains, found ${window.__madrvGains?.length ?? 0} gains.`);
    const analysers = gains.map((gain) => {
      const analyser = gain.context.createAnalyser();
      analyser.fftSize = 2048;
      gain.connect(analyser);
      return analyser;
    });
    const samples = analysers.map((analyser) => new Float32Array(analyser.fftSize));
    const startedAt = performance.now();
    const firstAudibleAt = [null, null, null];
    const peak = [0, 0, 0];
    while (performance.now() - startedAt < 5_000) {
      analysers.forEach((analyser, index) => {
        analyser.getFloatTimeDomainData(samples[index]);
        const currentPeak = samples[index].reduce((value, current) => Math.max(value, Math.abs(current)), 0);
        peak[index] = Math.max(peak[index], currentPeak);
        if (firstAudibleAt[index] === null && currentPeak > 0.002) firstAudibleAt[index] = performance.now() - startedAt;
      });
      await new Promise((resolve) => window.setTimeout(resolve, 4));
    }
    gains.forEach((gain, index) => gain.disconnect(analysers[index]));
    return { opmFirstAudibleAtMs: firstAudibleAt[0], pcmFirstAudibleAtMs: firstAudibleAt[1], midiFirstAudibleAtMs: firstAudibleAt[2], opmPeak: peak[0], pcmPeak: peak[1], midiPeak: peak[2] };
  });
  await page.getByLabel("停止").click();
  if (measured.midiFirstAudibleAtMs === null || measured.midiPeak < 0.002) throw new Error(`SoundFont MIDI output did not become audible: ${JSON.stringify(measured)}`);
  console.log(JSON.stringify({ soundFontPath, ...measured, soundFontOutputObserved: true }));
} finally {
  await browser.close();
}
