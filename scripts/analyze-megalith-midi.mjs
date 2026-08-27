import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const sourcePath = process.env.MDR_ANALYSIS_SOURCE ?? "/home/ubuntu/upload/MEGALITH.MDR";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const sourceBytes = await readFile(sourcePath);
  const result = await page.evaluate(async (sourceValues) => {
    const source = new Uint8Array(sourceValues).buffer;
    const moduleUrl = `${location.origin}/manus-storage/madrv-midi-events-v3_d61f79e9.mjs`;
    const wasmUrl = `${location.origin}/manus-storage/madrv-midi-events-v3_a93766ec.wasm`;
    const imported = await import(moduleUrl);
    const module = await imported.default({ locateFile: (file) => file.endsWith(".wasm") ? wasmUrl : file });
    const bytes = new Uint8Array(source);
    const sourcePointer = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, sourcePointer);
    try {
      const size = module._madrv_extract_midi(sourcePointer, bytes.length, 1, 48_000);
      if (size <= 0) return { bytes: bytes.length, eventCount: 0, lastEventSeconds: 0, tracks: [] };
      const target = module._malloc(size);
      try {
        if (module._madrv_copy_midi(target, size) !== size) throw new Error("Unable to copy MIDI events");
        const eventBytes = module.HEAPU8.slice(target, target + size);
        const view = new DataView(eventBytes.buffer, eventBytes.byteOffset, eventBytes.byteLength);
        const eventCount = view.getUint32(0, true);
        const tracks = new Set();
        const firstEvents = [];
        let offset = 4;
        let lastEventSeconds = 0;
        for (let index = 0; index < eventCount; index += 1) {
          const timestamp = Number(view.getBigUint64(offset, true)) / 1_000_000;
          offset += 8;
          tracks.add(view.getUint32(offset, true));
          offset += 4;
          const length = view.getUint32(offset, true);
          offset += 4;
          const message = Array.from(eventBytes.slice(offset, offset + length));
          offset += length;
          lastEventSeconds = Math.max(lastEventSeconds, timestamp);
          if (firstEvents.length < 12) firstEvents.push({ at: timestamp, track: Array.from(tracks).at(-1), bytes: message });
        }
        return { bytes: bytes.length, eventCount, lastEventSeconds, tracks: Array.from(tracks).sort((left, right) => left - right), firstEvents };
      } finally {
        module._free(target);
      }
    } finally {
      module._free(sourcePointer);
    }
  }, Array.from(sourceBytes));
  console.log(JSON.stringify({ sourcePath, ...result }));
} finally {
  await browser.close();
}
