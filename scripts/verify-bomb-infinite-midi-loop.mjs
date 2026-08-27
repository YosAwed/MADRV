import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const bombPath = process.env.MADRV_BOMB_PATH ?? "/home/ubuntu/upload/BOMB.MDR";
const soundFontPath = process.env.MADRV_SF_PATH ?? "/home/ubuntu/webdev-static-assets/GeneralUser-GS-v1.471.sf2";
const soundFontName = soundFontPath.split(/[\\/]/).at(-1) ?? soundFontPath;
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

function parseMilliseconds(value) {
  const match = value.trim().match(/^(\d+):(\d{2})\.(\d{3})$/);
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number(match[3]) : null;
}

function parseSignedMilliseconds(value) {
  const match = value.match(/([+-]?\d+)\s*ms/i);
  return match ? Number(match[1]) : null;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
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
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".sf2"]').setInputFiles(soundFontPath);
  await page.getByRole("button", { name: soundFontName, exact: true }).waitFor({ state: "visible", timeout: 90_000 });
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(bombPath);
  await page.getByRole("heading", { name: /BOMB/i }).waitFor({ state: "visible", timeout: 45_000 });
  await page.getByLabel("無限ループを切り替える").click();
  await page.getByLabel("OPM / PCMの出力レベル").fill("0");
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 30_000 });
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
      await new Promise(resolve => window.setTimeout(resolve, 5));
    }
    midiGain.disconnect(analyser);
    return peak;
  }, durationMs);
  // BOMB's converted MIDI includes a 40.109625s loop start and a 80.105625s
  // loop end. Observe the sequence boundary; the next L-derived pass must be
  // audible without replaying the non-looping intro.
  await page.waitForTimeout(78_500);
  const secondLoopMidiPeak = await captureMidiPeak(4_000);
  const afterBoundary = await page.evaluate(() => ({
    position: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "",
    delta: document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? "",
  }));
  await page.getByLabel("停止").click();
  const afterDelta = parseSignedMilliseconds(afterBoundary.delta);
  if (secondLoopMidiPeak < 0.02) throw new Error(`BOMB.MDRの2周目GS MIDIがMXDRV境界直後に発音しませんでした: ${JSON.stringify({ secondLoopMidiPeak, afterBoundary })}`);
  if (afterDelta === null || Math.abs(afterDelta) > 300) throw new Error(`BOMB.MDRの2周目GS MIDIがMXDRV境界へ戻りませんでした: ${JSON.stringify({ afterBoundary, afterDelta })}`);
  if (errors.length) throw new Error(`BOMB.MDR無限ループ中にconsole error: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ secondLoopMidiPeak, afterBoundary, afterDelta, errors }));
} finally {
  await browser.close();
}
