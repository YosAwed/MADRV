import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import createMidiEvents from "/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.mjs";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mdrPath = process.env.MADRV_MDR_PATH ?? "/home/ubuntu/upload/BOMB.MDR";
const pdxPath = process.env.MADRV_PDX_PATH;
const expectedTitle = process.env.MADRV_EXPECTED_TITLE ?? "BOMB";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

async function extractLoopWindow(sourcePath) {
  const source = new Uint8Array(await readFile(sourcePath));
  const wasmBinary = await readFile("/home/ubuntu/madrv-wasm/build/madrv-midi-events-v4.wasm");
  const module = await createMidiEvents({ wasmBinary });
  const pointer = module._malloc(source.byteLength);
  module.HEAPU8.set(source, pointer);
  try {
    if (module._madrv_extract_midi(pointer, source.byteLength, 1, 48_000) <= 0) throw new Error("MDR MIDI extraction failed while reading loop window.");
    const hasSongLoop = module._madrv_midi_has_song_loop() === 1;
    const startSeconds = module._madrv_midi_loop_start_seconds();
    const endSeconds = module._madrv_midi_loop_end_seconds();
    return hasSongLoop && Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds
      ? { startSeconds, endSeconds }
      : null;
  } finally {
    module._free(pointer);
  }
}

const loopWindow = await extractLoopWindow(mdrPath);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  await page.addInitScript(() => {
    window.__madrvExternalMidiEvents = [];
    const output = {
      id: "madrv-loop-window-mock",
      name: "MDR Loop Window Mock",
      send(data, timestamp) {
        window.__madrvExternalMidiEvents.push({ at: performance.now(), timestamp: timestamp ?? null, bytes: Array.from(data) });
      },
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => ({ outputs: new Map([[output.id, output]]) }),
    });
  });
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByRole("button", { name: "External MIDI" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(mdrPath);
  if (pdxPath) await page.locator('input[type="file"][accept*=".pdx"]').setInputFiles(pdxPath);
  if (expectedTitle) await page.getByRole("heading", { name: new RegExp(expectedTitle, "i") }).waitFor({ state: "visible", timeout: 45_000 });
  if (loopWindow) await page.getByLabel("無限ループを切り替える").click();
  const playStartedAt = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 30_000 });
  // The generic scheduler must preserve each MDR's converted L-derived window
  // when the target is Web MIDI. Non-looping MDRs still validate output + STOP.
  await page.waitForTimeout(loopWindow ? Math.ceil(loopWindow.endSeconds * 1000 + 1_500) : 2_000);
  const beforeStop = await page.evaluate(() => window.__madrvExternalMidiEvents);
  await page.getByLabel("停止").click();
  await page.waitForTimeout(120);
  const afterStop = await page.evaluate(() => window.__madrvExternalMidiEvents);

  const isGsReset = event => event.bytes.length === 11 && event.bytes.every((value, index) => value === [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7][index]);
  const isNoteOn = event => (event.bytes[0] & 0xf0) === 0x90 && event.bytes[2] > 0;
  const expectedLoopBoundaryAt = loopWindow ? playStartedAt + loopWindow.endSeconds * 1000 : null;
  const loopWindowNotes = expectedLoopBoundaryAt === null ? [] : beforeStop.filter(event => isNoteOn(event) && event.at >= expectedLoopBoundaryAt - 4_000 && event.at <= expectedLoopBoundaryAt + 4_000);
  const stopMessages = afterStop.slice(beforeStop.length).filter(event => (event.bytes[0] & 0xf0) === 0xb0 && (event.bytes[1] === 120 || event.bytes[1] === 123));
  const scheduledExternalEvents = beforeStop.filter(event => typeof event.timestamp === "number" && Number.isFinite(event.timestamp));

  if (beforeStop.filter(isGsReset).length > 1) throw new Error(`External MIDI repeated GS Reset after the first pass: ${beforeStop.filter(isGsReset).length}`);
  if (loopWindow && !loopWindowNotes.length) throw new Error(`External MIDI received no note-on around the converted loop window: ${JSON.stringify({ expectedLoopBoundaryAt, loopWindow, count: beforeStop.length })}`);
  if (!scheduledExternalEvents.length) throw new Error("External MIDI did not receive timestamped scheduled events.");
  if (!stopMessages.length) throw new Error("STOP did not send an external MIDI all-notes/all-sound-off message.");
  if (errors.length) throw new Error(`External MIDI loop window regression logged console errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ mdrPath, loopWindow, eventCount: beforeStop.length, loopWindowNoteCount: loopWindowNotes.length, gsResetCount: beforeStop.filter(isGsReset).length, stopMessageCount: stopMessages.length, errors }));
} finally {
  await browser.close();
}
