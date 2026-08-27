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
      }
    };
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const chipSlider = page.getByLabel("OPM / PCMの出力レベル");
  const midiSlider = page.getByLabel("GS MIDIの出力レベル");
  await chipSlider.fill("37");
  await page.waitForTimeout(180);
  const first = await page.evaluate(() => window.__madrvGains?.slice(1, 4).map((gain) => gain.gain.value));
  await chipSlider.fill("0");
  await page.waitForTimeout(180);
  const muted = await page.evaluate(() => window.__madrvGains?.slice(1, 4).map((gain) => gain.gain.value));
  await midiSlider.fill("55");
  await page.waitForTimeout(180);
  const midiChanged = await page.evaluate(() => window.__madrvGains?.slice(1, 4).map((gain) => gain.gain.value));
  const closeTo = (actual, expected) => Math.abs(actual - expected) < 0.001;
  if (!first || !closeTo(first[0], 0.37) || !closeTo(first[1], 0.37) || !closeTo(first[2], 0.72)) throw new Error(`OPM/PCM chip level was not synchronized: ${JSON.stringify({ first })}`);
  if (!muted || !closeTo(muted[0], 0) || !closeTo(muted[1], 0) || !closeTo(muted[2], 0.72)) throw new Error(`OPM/PCM chip mute changed MIDI unexpectedly: ${JSON.stringify({ muted })}`);
  if (!midiChanged || !closeTo(midiChanged[0], 0) || !closeTo(midiChanged[1], 0) || !closeTo(midiChanged[2], 0.55)) throw new Error(`MIDI level changed the chip mix unexpectedly: ${JSON.stringify({ midiChanged })}`);
  console.log(JSON.stringify({ first, muted, midiChanged, chipMixUnified: true, midiIndependent: true }));
} finally {
  await browser.close();
}
