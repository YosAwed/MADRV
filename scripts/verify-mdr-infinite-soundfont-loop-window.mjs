import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import createMidiEvents from "/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.mjs";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mdrPath = process.env.MADRV_MDR_PATH ?? "/home/ubuntu/upload/BOMB.MDR";
const soundFontPath = process.env.MADRV_SF_PATH ?? "/home/ubuntu/webdev-static-assets/GeneralUser-GS-v1.471.sf2";
const expectedTitle = process.env.MADRV_EXPECTED_TITLE ?? "BOMB";
const soundFontName = soundFontPath.split(/[\\/]/).at(-1) ?? soundFontPath;

async function extractLoopWindow(sourcePath) {
  const source = new Uint8Array(await readFile(sourcePath));
  const wasmBinary = await readFile("/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.wasm");
  const module = await createMidiEvents({ wasmBinary });
  const pointer = module._malloc(source.byteLength);
  module.HEAPU8.set(source, pointer);
  try {
    if (module._madrv_extract_midi(pointer, source.byteLength, 1, 48_000) <= 0) throw new Error("MDR MIDI extraction failed while reading loop window.");
    const startSeconds = module._madrv_midi_loop_start_seconds();
    const endSeconds = module._madrv_midi_loop_end_seconds();
    if (module._madrv_midi_has_song_loop() !== 1 || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
      throw new Error("MDR has no valid converted song loop window.");
    }
    return { startSeconds, endSeconds };
  } finally {
    module._free(pointer);
  }
}

const loopWindow = await extractLoopWindow(mdrPath);
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

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
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(mdrPath);
  if (expectedTitle) await page.getByRole("heading", { name: new RegExp(expectedTitle, "i") }).waitFor({ state: "visible", timeout: 45_000 });
  await page.getByLabel("無限ループを切り替える").click();
  await page.getByLabel("OPM / PCMの出力レベル").fill("0");
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 30_000 });
  const captureMidiPeak = async durationMs => page.evaluate(async duration => {
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
      peak = Math.max(peak, ...samples.map(value => Math.abs(value)));
      await new Promise(resolve => window.setTimeout(resolve, 5));
    }
    midiGain.disconnect(analyser);
    return peak;
  }, durationMs);
  await page.waitForTimeout(Math.max(0, Math.ceil(loopWindow.endSeconds * 1000 - 1_500)));
  const nextLoopMidiPeak = await captureMidiPeak(4_000);
  const afterBoundary = await page.evaluate(() => ({
    position: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "",
    delta: document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? "",
  }));
  await page.getByLabel("停止").click();
  if (nextLoopMidiPeak < 0.02) throw new Error(`MDRの次周GS MIDIが曲全体ループ窓直後に発音しませんでした: ${JSON.stringify({ loopWindow, nextLoopMidiPeak, afterBoundary })}`);
  if (errors.length) throw new Error(`MDRの内蔵SoundFontループ中にconsole error: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ mdrPath, loopWindow, nextLoopMidiPeak, afterBoundary, errors }));
} finally {
  await browser.close();
}
