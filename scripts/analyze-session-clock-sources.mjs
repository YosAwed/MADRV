import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "https://madrvplay-elrop8px.manus.space";
const sourceUrl = process.env.MADRV_SESSION_MDR_URL ?? "https://drive.google.com/file/d/1du96-9og-KQ9Cx8S59r7H__gllfzsWkQ/view?usp=share_link";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const result = await page.evaluate(async ({ sourceUrl }) => {
    const response = await fetch("/api/trpc/publicStorage.fetchAsset?batch=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ 0: { json: { url: sourceUrl, kind: "mdr" } } }),
    });
    if (!response.ok) throw new Error(`MDR proxy HTTP ${response.status}`);
    const envelope = await response.json();
    const payload = envelope[0]?.result?.data?.json;
    if (!payload?.dataBase64) throw new Error("MDR proxy did not return binary payload");
    const binary = atob(payload.dataBase64);
    const source = Uint8Array.from(binary, character => character.charCodeAt(0));
    const copyTo = (module, bytes) => { const pointer = module._malloc(bytes.length); module.HEAPU8.set(bytes, pointer); return pointer; };
    const midiFactory = (await import("/manus-storage/madrv-midi-events-v3_d61f79e9.mjs")).default;
    const midiModule = await midiFactory({ locateFile: file => file.endsWith(".wasm") ? "/manus-storage/madrv-midi-events-v3_a93766ec.wasm" : file });
    const midiSource = copyTo(midiModule, source);
    let midiEvents = [];
    try {
      const size = midiModule._madrv_extract_midi(midiSource, source.length, 1, 48_000);
      if (size > 0) {
        const target = midiModule._malloc(size);
        try {
          if (midiModule._madrv_copy_midi(target, size) !== size) throw new Error("MIDI copy failure");
          const bytes = midiModule.HEAPU8.slice(target, target + size);
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const count = view.getUint32(0, true);
          let offset = 4;
          for (let index = 0; index < count; index += 1) {
            const microseconds = Number(view.getBigUint64(offset, true)); offset += 8;
            const sourceTrack = view.getUint32(offset, true); offset += 4;
            const length = view.getUint32(offset, true); offset += 4 + length;
            midiEvents.push({ at: microseconds / 1_000_000, sourceTrack });
          }
        } finally { midiModule._free(target); }
      }
    } finally { midiModule._free(midiSource); }
    const converterFactory = (await import("/manus-storage/madrv-converter-v4_28935c58.mjs")).default;
    const playerFactory = (await import("/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs")).default;
    const converter = await converterFactory({ locateFile: file => file.endsWith(".wasm") ? "/manus-storage/madrv-converter-v4_f7f66741.wasm" : file });
    const player = await playerFactory({ locateFile: file => file.endsWith(".wasm") ? "/manus-storage/madrv-mdx-player-v12_2d6b7625.wasm" : file });
    const converterSource = copyTo(converter, source);
    let hardwareDurationSeconds = null;
    try {
      const convertedSize = converter._madrv_convert_mdr(converterSource, source.length);
      if (convertedSize <= 0) throw new Error("MDR conversion failed");
      const converted = converter._malloc(convertedSize);
      try {
        if (converter._madrv_copy_converted(converted, convertedSize) !== convertedSize) throw new Error("converted copy failure");
        const mdxPointer = copyTo(player, converter.HEAPU8.slice(converted, converted + convertedSize));
        try {
          if (player._mdx_player_init(48_000) !== 0) throw new Error("player init failed");
          if (player._mdx_player_load(mdxPointer, convertedSize, 0, 0) !== 0) throw new Error("player load failed");
          hardwareDurationSeconds = player._mdx_player_measure(1, 0) / 1000;
        } finally { player._free(mdxPointer); }
      } finally { converter._free(converted); }
    } finally { converter._free(converterSource); }
    const lastMidiSecond = midiEvents.reduce((latest, event) => Math.max(latest, event.at), 0);
    return { sourceBytes: source.length, eventCount: midiEvents.length, firstMidiSecond: midiEvents[0]?.at ?? null, lastMidiSecond, hardwareDurationSeconds, tailDifferenceSeconds: hardwareDurationSeconds === null ? null : lastMidiSecond - hardwareDurationSeconds, finalEvents: midiEvents.slice(-8) };
  }, { sourceUrl });
  console.log(JSON.stringify({ sourceUrl, ...result }));
} finally {
  await browser.close();
}
