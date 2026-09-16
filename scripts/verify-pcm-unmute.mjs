import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import createPlayer from "../client/public/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs";

const assets = new URL("../client/public/", import.meta.url);
const engine = readFileSync(new URL("../client/src/lib/madrvEngine.ts", import.meta.url), "utf8");
const wasmPath = engine.match(/const PLAYER_WASM_URL = "([^"]+)"/)[1];
const fixed = readFileSync(new URL(`.${wasmPath}`, assets));
const original = readFileSync(new URL("./public/manus-storage/madrv-mdx-player-v12_2d6b7625.wasm", new URL("../client/", import.meta.url)));
const frames = 128;
const unmuteFrame = 24064;

// Original synthetic data: no copyrighted song or sample is needed for the test.
// The first short sample should end long before unmute at ~0.5s, even though
// its score note lasts longer. The next real trigger is at ~2.765s.
function fixture(channel = 8, pcm8 = false) {
  const tracks = Array.from({ length: pcm8 ? 16 : 9 }, (_, index) => Buffer.from(
    index === channel ? [0xfc, 3, 0xfb, 15, 0xed, 4, 0x80, 95, 95, 0x80, 95, 95, 0xf1, 0]
      : [...(pcm8 && index === 0 ? [0xe8] : []), 0xf1, 0]));
  const header = Buffer.alloc(2 + tracks.length * 2);
  let offset = header.length;
  tracks.forEach((track, index) => { header.writeUInt16BE(offset, 2 + index * 2); offset += track.length; });
  header.writeUInt16BE(offset, 0);
  const mdx = Buffer.concat([Buffer.from("PCM unmute regression\r\n\x1aTEST\0"), header, ...tracks]);
  const pdx = Buffer.alloc(768 + 512);
  pdx.writeUInt32BE(768, 0);
  pdx.writeUInt32BE(512, 4);
  for (let index = 768; index < pdx.length; index++) pdx[index] = index % 16 < 8 ? 0x11 : 0x99;
  return { mdx, pdx };
}

async function render(wasmBinary, { channel = 8, pcm8 = false, changes = [], source = fixture(channel, pcm8) } = {}) {
  const player = await createPlayer({ wasmBinary });
  assert.equal(player._mdx_player_init(48000), 0);
  const copy = bytes => { const pointer = player._malloc(bytes.length); player.HEAPU8.set(bytes, pointer); return pointer; };
  const mdx = copy(source.mdx), pdx = copy(source.pdx), output = player._malloc(frames * 4);
  const samples = new Int16Array(48000 * 3 * 2);
  const onsets = [];
  let previous = 0;
  try {
    assert.equal(player._mdx_player_load(mdx, source.mdx.length, pdx, source.pdx.length), 0);
    player._mdx_player_play(1);
    for (let frame = 0; frame < samples.length / 2; frame += frames) {
      for (const [at, mask] of changes) if (at === frame) assert.equal(player._mdx_player_set_channel_mask(mask), 0);
      const count = Math.min(frames, samples.length / 2 - frame);
      assert.ok(player._mdx_player_render(output, count) >= 0);
      samples.set(player.HEAP16.subarray(output / 2, output / 2 + count * 2), frame * 2);
      const active = player._mdx_player_get_pcm_active_mask();
      if (active & ~previous) onsets.push(frame);
      previous = active;
    }
    return { samples, onsets };
  } finally {
    for (const pointer of [mdx, pdx, output]) player._free(pointer);
    player._mdx_player_dispose();
  }
}
const peak = samples => samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
const results = [];
for (const pcm8 of [false, true]) {
  for (let channel = 8; channel < (pcm8 ? 16 : 9); channel++) {
    const mask = 1 << channel;
    const normal = await render(original, { channel, pcm8 });
    assert.equal(normal.onsets.length, 2, "fixture must contain two actual PCM triggers");
    const noMute = await render(fixed, { channel, pcm8 });
    assert.deepEqual(noMute.samples, normal.samples, "unmuted output must remain bit-identical");
    const changes = [[0, mask], [unmuteFrame, 0]];
    const before = await render(original, { channel, pcm8, changes });
    assert.ok(before.onsets.includes(unmuteFrame), "original core must reproduce the stale key-on");
    for (const transitions of [changes, [...changes, [24192, mask], [24320, 0]], [[0, mask], [unmuteFrame, 1], [24192, 0]]]) {
      const after = await render(fixed, { channel, pcm8, changes: transitions });
      assert.deepEqual(after.onsets, normal.onsets.slice(1), "only the next score note may start after unmute");
      assert.equal(peak(after.samples.subarray(0, normal.onsets[1] * 2)), 0, "no delayed audio before the next real note");
      assert.ok(peak(after.samples.subarray(normal.onsets[1] * 2)) > 100, "next real note must remain audible");
    }
    // Changing OPM masks or re-applying an unchanged mask must not affect PCM.
    const unrelated = await render(fixed, { channel, pcm8, changes: [[0, 1], [unmuteFrame, 0], [24192, 0]] });
    assert.deepEqual(unrelated.samples, normal.samples);
    results.push({ mode: pcm8 ? "PCM8" : "ADPCM", channel, staleOnsetSeconds: unmuteFrame / 48000, nextNoteSeconds: normal.onsets[1] / 48000 });
  }
}

console.log(JSON.stringify({ results, passed: true }, null, 2));
