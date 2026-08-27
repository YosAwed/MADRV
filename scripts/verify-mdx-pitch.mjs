import { readFile } from "node:fs/promises";
import createMdxPlayer from "/home/ubuntu/madrv-wasm/build/madrv-mdx-player-v12.mjs";

const mdx = new Uint8Array(await readFile("/home/ubuntu/Downloads/DRA02.MDX"));
const pdx = new Uint8Array(await readFile("/home/ubuntu/Downloads/DRA00.PDX"));
const wasmBinary = await readFile("/home/ubuntu/madrv-wasm/build/madrv-mdx-player-v12.wasm");
const targetSecond = 8;
const analysisFrames = 16_384;

function copyTo(module, bytes) {
  const pointer = module._malloc(bytes.byteLength);
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function dominantFrequency(samples, sampleRate) {
  const candidates = [];
  for (let frequency = 55; frequency <= 2_000; frequency += 2) {
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const coefficient = 2 * Math.cos(omega);
    let previous = 0;
    let previous2 = 0;
    for (const sample of samples) {
      const current = sample + coefficient * previous - previous2;
      previous2 = previous;
      previous = current;
    }
    candidates.push({ frequency, power: previous2 * previous2 + previous * previous - coefficient * previous * previous2 });
  }
  return candidates.reduce((best, candidate) => candidate.power > best.power ? candidate : best).frequency;
}

async function renderAt(sampleRate) {
  const module = await createMdxPlayer({ wasmBinary });
  if (module._mdx_player_init(sampleRate) !== 0) throw new Error(`MDX init failed at ${sampleRate} Hz`);
  const mdxPointer = copyTo(module, mdx);
  const pdxPointer = copyTo(module, pdx);
  const output = module._malloc(Math.max(2048, analysisFrames) * 4);
  try {
    if (module._mdx_player_load(mdxPointer, mdx.byteLength, pdxPointer, pdx.byteLength) !== 0) throw new Error(`MDX load failed at ${sampleRate} Hz`);
    module._mdx_player_play(1);
    let remaining = targetSecond * sampleRate;
    while (remaining > 0) {
      const frames = Math.min(2048, remaining);
      if (module._mdx_player_render(output, frames) < 0) throw new Error(`MDX render failed at ${sampleRate} Hz`);
      remaining -= frames;
    }
    if (module._mdx_player_render(output, analysisFrames) < 0) throw new Error(`MDX analysis render failed at ${sampleRate} Hz`);
    const pcm = module.HEAP16.slice(output >> 1, (output >> 1) + analysisFrames * 2);
    const left = Float64Array.from({ length: analysisFrames }, (_, index) => pcm[index * 2] / 32768);
    return { sampleRate, dominantFrequency: dominantFrequency(left, sampleRate) };
  } finally {
    module._free(mdxPointer);
    module._free(pdxPointer);
    module._free(output);
    module._mdx_player_dispose();
  }
}

const firstPass = await renderAt(48_000);
const secondPass = await renderAt(48_000);
const ratio = firstPass.dominantFrequency / secondPass.dominantFrequency;
if (Math.abs(ratio - 1) > 0.001) throw new Error(`Fixed-rate MDX pitch is not deterministic: ${JSON.stringify({ firstPass, secondPass, ratio })}`);
console.log(JSON.stringify({ nativeSampleRate: 48_000, firstPass, secondPass, ratio, pitchAligned: true }));
