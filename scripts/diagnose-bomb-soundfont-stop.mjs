import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const soundFontPath = process.env.SOUND_FONT_PATH ?? "/home/ubuntu/webdev-static-assets/GeneralUser-GS-v1.471.sf2";
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
  await page.getByRole("button", { name: "GeneralUser-GS-v1.471.sf2", exact: true }).waitFor({ state: "visible", timeout: 90_000 });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles("/home/ubuntu/upload/BOMB.MDR");
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(300);
  const captureMidiPeak = async (durationMs) => page.evaluate(async (duration) => {
    const midiGain = window.__madrvGains?.slice(1, 4)?.[2];
    if (!midiGain) throw new Error(`MIDI gain was unavailable: ${window.__madrvGains?.length ?? 0}`);
    const analyser = midiGain.context.createAnalyser();
    analyser.fftSize = 2048;
    midiGain.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let peak = 0;
    const startedAt = performance.now();
    while (performance.now() - startedAt < duration) {
      analyser.getFloatTimeDomainData(samples);
      peak = Math.max(peak, ...samples.map((value) => Math.abs(value)));
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    }
    midiGain.disconnect(analyser);
    return peak;
  }, durationMs);
  const playingPeak = await captureMidiPeak(2_000);
  await page.getByLabel("停止").click();
  const afterStopEarlyPeak = await captureMidiPeak(250);
  const afterStopMidPeak = await captureMidiPeak(500);
  const afterStopLatePeak = await captureMidiPeak(750);
  const staleMidiAfterStop = afterStopMidPeak > 0.01 || afterStopLatePeak > 0.01;
  if (playingPeak < 0.02) throw new Error(`BOMB.MDR SoundFont MIDI was not audible during playback: ${JSON.stringify({ playingPeak })}`);
  if (staleMidiAfterStop) throw new Error(`BOMB.MDR SoundFont MIDI remained audible after Stop: ${JSON.stringify({ afterStopEarlyPeak, afterStopMidPeak, afterStopLatePeak })}`);
  console.log(JSON.stringify({ soundFontPath, playingPeak, afterStopEarlyPeak, afterStopMidPeak, afterStopLatePeak, staleMidiAfterStop, bombMidiPlaysBeforeStop: true }));
} finally {
  await browser.close();
}
