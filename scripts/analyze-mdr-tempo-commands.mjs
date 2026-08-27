import { readFile } from "node:fs/promises";

const sourcePath = process.env.MDR_TEMPO_SOURCE ?? "/home/ubuntu/upload/HECT_GS2.MDR";
const bytes = new Uint8Array(await readFile(sourcePath));
const marker = bytes.findIndex((value, index) => value === 0x0d && bytes[index + 1] === 0x0a && bytes[index + 2] === 0x1a);
if (marker < 0) throw new Error("MDR title marker not found");
let pdxEnd = marker + 3;
while (pdxEnd < bytes.length && bytes[pdxEnd] !== 0) pdxEnd += 1;
const table = pdxEnd + 1;
const word = (offset) => (bytes[offset] << 8) | bytes[offset + 1];
const toneOffset = table + word(table);
const offsets = Array.from({ length: 32 }, (_, track) => table + word(table + 2 + track * 2));
const tracks = offsets.map((start, track) => {
  const end = track < 31 ? offsets[track + 1] : toneOffset;
  const tempos = [];
  for (let index = start; index + 1 < end; index += 1) {
    if (bytes[index] === 0xff) tempos.push({ relativeOffset: index - start, value: bytes[index + 1] });
  }
  return { track, engine: track < 8 ? "opm" : track < 16 ? "pcm" : "gs-midi", bytes: end - start, tempos };
}).filter((track) => track.tempos.length > 0);
console.log(JSON.stringify({ sourcePath, title: new TextDecoder("shift-jis", { fatal: false }).decode(bytes.slice(0, marker)), pdx: new TextDecoder("shift-jis", { fatal: false }).decode(bytes.slice(marker + 3, pdxEnd)), tracks }, null, 2));
