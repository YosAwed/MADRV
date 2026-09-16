import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import createPlayer from "../client/public/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs";

// Read local fixtures without copying them into the repository or uploading them.
const [mdxPath, pdxPath] = process.argv.slice(2);
if (!mdxPath) throw new Error("Usage: node scripts/verify-playback-seek-wasm.mjs /path/to/song.mdx [/path/to/bank.pdx]");
const mdx = await readFile(mdxPath);
const pdx = pdxPath ? await readFile(pdxPath) : new Uint8Array();
const wasmBinary = await readFile(new URL("../client/public/manus-storage/madrv-mdx-player-v13_6e789f63.wasm", import.meta.url));
const code = await transform(await readFile(new URL("../client/src/lib/playbackSeek.ts", import.meta.url), "utf8"), { loader: "ts", format: "esm" });
const { advancePlaybackSilently } = await import(`data:text/javascript;base64,${Buffer.from(code.code).toString("base64")}`);

async function player(loops) {
  const core = await createPlayer({ wasmBinary });
  assert.equal(core._mdx_player_init(48_000), 0);
  const source = core._malloc(mdx.length);
  const bank = pdx.length ? core._malloc(pdx.length) : 0;
  core.HEAPU8.set(mdx, source);
  if (bank) core.HEAPU8.set(pdx, bank);
  assert.equal(core._mdx_player_load(source, mdx.length, bank, pdx.length), 0);
  core._free(source);
  if (bank) core._free(bank);
  const duration = core._mdx_player_measure(loops, 0) / 1000;
  core._mdx_player_play(loops);
  const output = core._malloc(4096 * 4);
  return {
    duration,
    isTerminated: () => core._mdx_player_is_terminated() !== 0,
    renderInto(left, right) {
      assert.ok(core._mdx_player_render(output, left.length) >= 0);
      for (let i = 0; i < left.length; i++) {
        left[i] = core.HEAP16[(output >> 1) + 2 * i] / 32768;
        right[i] = core.HEAP16[(output >> 1) + 2 * i + 1] / 32768;
      }
      return 0;
    },
    dispose() { core._free(output); core._mdx_player_dispose(); },
  };
}

const results = [];
for (const loops of [1, 2]) {
  const probe = await player(loops);
  const duration = probe.duration;
  probe.dispose();
  for (const fraction of [0.02, 0.5, 0.9]) {
    const seconds = Math.floor(duration * fraction * 48_000) / 48_000;
    const baseline = await player(loops);
    const seeking = await player(loops);
    try {
      const left = new Float32Array(128), right = new Float32Array(128);
      let remaining = Math.round(seconds * 48_000);
      while (remaining > 0 && !baseline.isTerminated()) {
        const frames = Math.min(128, remaining);
        baseline.renderInto(left.subarray(0, frames), right.subarray(0, frames));
        remaining -= frames;
      }
      const started = performance.now();
      await advancePlaybackSilently(seeking, seconds, 48_000, () => {});
      const costMs = performance.now() - started;
      const actualLeft = new Float32Array(4096), actualRight = new Float32Array(4096);
      const expectedLeft = new Float32Array(4096), expectedRight = new Float32Array(4096);
      baseline.renderInto(expectedLeft, expectedRight);
      seeking.renderInto(actualLeft, actualRight);
      assert.deepEqual(actualLeft, expectedLeft, `Left PCM differs at ${seconds}s (${loops} loops)`);
      assert.deepEqual(actualRight, expectedRight, `Right PCM differs at ${seconds}s (${loops} loops)`);
      results.push({ loops, seconds, costMs: Math.round(costMs), identicalSamples: 8192 });
    } finally { baseline.dispose(); seeking.dispose(); }
  }
}
console.log(JSON.stringify({ nativeSampleRate: 48_000, results }, null, 2));
