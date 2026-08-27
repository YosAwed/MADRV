import { readFile } from "node:fs/promises";

const playerVersion = process.env.MDR_PLAYER_VERSION ?? "v12";
const converterVersion = process.env.MDR_CONVERTER_VERSION ?? "base";
const sourcePath = process.env.MDR_DIAG_SOURCE ?? "/home/ubuntu/upload/MEGALITH.MDR";
const pdxPath = process.env.MDR_DIAG_PDX ?? "/home/ubuntu/upload/MEGALITH.PDX";
const renderBlocks = Number(process.env.MDR_DIAG_BLOCKS ?? "120");
const reportEvery = Number(process.env.MDR_DIAG_REPORT_EVERY ?? "12");
const converterModulePath = converterVersion === "base" ? "/home/ubuntu/webdev-static-assets/madrv-converter.mjs" : `/home/ubuntu/madrv-wasm/build/madrv-converter-${converterVersion}.mjs`;
const converterWasmPath = converterVersion === "base" ? "/home/ubuntu/webdev-static-assets/madrv-converter.wasm" : `/home/ubuntu/madrv-wasm/build/madrv-converter-${converterVersion}.wasm`;
const { default: createConverter } = await import(converterModulePath);
const { default: createPlayer } = await import(`/home/ubuntu/madrv-wasm/build/madrv-mdx-player-${playerVersion}.mjs`);

const mdr = new Uint8Array(await readFile(sourcePath));
const pdx = pdxPath ? new Uint8Array(await readFile(pdxPath)) : new Uint8Array();
const converterWasm = await readFile(converterWasmPath);
const playerWasm = await readFile(`/home/ubuntu/madrv-wasm/build/madrv-mdx-player-${playerVersion}.wasm`);

function copyTo(module, bytes) {
  const pointer = module._malloc(bytes.byteLength);
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

const converter = await createConverter({ wasmBinary: converterWasm });
const player = await createPlayer({ wasmBinary: playerWasm });
const sourcePointer = copyTo(converter, mdr);
let convertedPointer = 0;
let mdxPointer = 0;
let pdxPointer = 0;
let outputPointer = 0;
try {
  const convertedSize = converter._madrv_convert_mdr(sourcePointer, mdr.byteLength);
  if (convertedSize <= 0) throw new Error(`MDR conversion failed: ${convertedSize}`);
  convertedPointer = converter._malloc(convertedSize);
  if (converter._madrv_copy_converted(convertedPointer, convertedSize) !== convertedSize) throw new Error("MDR conversion copy failed");
  if (player._mdx_player_init(48_000) !== 0) throw new Error("Player init failed");
  mdxPointer = copyTo(player, converter.HEAPU8.slice(convertedPointer, convertedPointer + convertedSize));
  pdxPointer = copyTo(player, pdx);
  if (player._mdx_player_load(mdxPointer, convertedSize, pdxPointer, pdx.byteLength) !== 0) throw new Error("Player load failed");
  const duration = player._mdx_player_measure(1, 0);
  if (player._mdx_player_play(1) !== 0) throw new Error("Player start failed");
  const frames = 2048;
  outputPointer = player._malloc(frames * 4);
  const blocks = [];
  for (let index = 0; index < renderBlocks; index += 1) {
    const result = player._mdx_player_render(outputPointer, frames);
    const pcm = player.HEAP16.subarray(outputPointer >> 1, (outputPointer >> 1) + frames * 2);
    let peak = 0;
    for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
    if (index % reportEvery === 0) blocks.push({ atSeconds: index * frames / 48_000, result, peak, timerB: player._mdx_player_get_timer_b(), playheadMs: player._mdx_player_get_play_at_ms() });
  }
  console.log(JSON.stringify({ sourcePath, playerVersion, converterVersion, convertedSize, duration, blocks }));
} finally {
  if (outputPointer) player._free(outputPointer);
  if (mdxPointer) player._free(mdxPointer);
  if (pdxPointer) player._free(pdxPointer);
  if (convertedPointer) converter._free(convertedPointer);
  converter._free(sourcePointer);
  player._mdx_player_dispose();
}
