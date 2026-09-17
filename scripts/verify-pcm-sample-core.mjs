import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import createPlayer from "../client/public/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs";
const original = readFileSync(
  new URL(
    "../client/public/manus-storage/madrv-mdx-player-v13_6e789f63.wasm",
    import.meta.url
  )
);
const changed = readFileSync(
  new URL(
    "../client/public/manus-storage/madrv-mdx-player-v14_09c287f0.wasm",
    import.meta.url
  )
);
function fixture(channel, pcm8, withFm = false) {
  const tracks = Array.from({ length: pcm8 ? 16 : 9 }, (_, i) =>
    Buffer.from(
      i === channel
        ? [
            0xfc,
            3,
            0xfb,
            15,
            0xed,
            4,
            0xfd,
            0,
            0xf7,
            0x80,
            23,
            0xfd,
            2,
            23, // bank changes while the first tied sample still plays
            0xfd,
            1,
            0x81,
            47,
            47,
            0xfd,
            2,
            0xdf,
            47,
            47,
            0xf1,
            0,
          ]
        : [
            ...(pcm8 && i === 0 ? [0xe8] : []),
            ...(withFm && i === 0
              ? [0xfd, 0, 0xfc, 3, 0xfb, 10, 0xb0, 95, 0xb4, 95, 0xb7, 95]
              : []),
            0xf1,
            0,
          ]
    )
  );
  const header = Buffer.alloc(2 + tracks.length * 2);
  let offset = header.length;
  tracks.forEach((t, i) => {
    header.writeUInt16BE(offset, 2 + i * 2);
    offset += t.length;
  });
  header.writeUInt16BE(offset, 0);
  const mdx = Buffer.concat([
    Buffer.from("PCM sample identity\r\n\x1aNUMBER\0"),
    header,
    ...tracks,
    ...(withFm
      ? [
          Buffer.from([
            0, 7, 15, 1, 1, 1, 1, 127, 127, 127, 32, 31, 31, 31, 31, 0, 0, 0, 0,
            0, 0, 0, 0, 15, 15, 15, 15,
          ]),
        ]
      : []),
  ]);
  const indices = [0, 1, 95, 97, 287],
    size = 32768;
  const pdx = Buffer.alloc(288 * 8 + size * indices.length);
  indices.forEach((number, i) => {
    const start = 288 * 8 + i * size;
    pdx.writeUInt32BE(start, number * 8);
    pdx.writeUInt32BE(size, number * 8 + 4);
    for (let j = 0; j < size; j++)
      pdx[start + j] = (j + i) % 16 < 8 ? 0x11 : 0x99;
  });
  return { mdx, pdx };
}
async function render(binary, channel, pcm8, muted = false, withFm = false) {
  const player = await createPlayer({ wasmBinary: binary });
  assert.equal(player._mdx_player_init(48000), 0);
  const { mdx, pdx } = fixture(channel, pcm8, withFm),
    m = player._malloc(mdx.length),
    p = player._malloc(pdx.length),
    o = player._malloc(256 * 4);
  player.HEAPU8.set(mdx, m);
  player.HEAPU8.set(pdx, p);
  const audio = new Int16Array(48000 * 4 * 2),
    changes = [],
    masks = [];
  let prior = -1,
    heldBankChange = false;
  try {
    assert.equal(player._mdx_player_load(m, mdx.length, p, pdx.length), 0);
    player._mdx_player_play(1);
    if (muted) player._mdx_player_set_channel_mask(1 << channel);
    for (let frame = 0; frame < audio.length / 2; frame += 256) {
      const count = Math.min(256, audio.length / 2 - frame);
      player._mdx_player_render(o, count);
      audio.set(player.HEAP16.subarray(o / 2, o / 2 + count * 2), frame * 2);
      const mask = player.asm.get_pcm_activity_mask
        ? player.asm.get_pcm_activity_mask()
        : player._mdx_player_get_pcm_active_mask();
      masks.push(mask);
      if (player.asm.get_pcm_sample_number) {
        const number = player.asm.get_pcm_sample_number(channel - 8);
        if (number !== prior) {
          changes.push(number);
          prior = number;
        }
        if (
          frame / 48000 > 0.42 &&
          frame / 48000 < 0.6 &&
          mask & (1 << (channel - 8))
        ) {
          assert.equal(
            number,
            0,
            "bank command must not relabel the held sample"
          );
          heldBankChange = true;
        }
        for (let voice = 0; voice < 8; voice++)
          if (voice !== channel - 8)
            assert.equal(player.asm.get_pcm_sample_number(voice), -1);
      }
    }
    return { audio, changes, masks, heldBankChange };
  } finally {
    for (const ptr of [m, p, o]) player._free(ptr);
    player._mdx_player_dispose();
  }
}
const report = [];
for (const pcm8 of [false, true])
  for (let channel = 8; channel < (pcm8 ? 16 : 9); channel++) {
    const before = await render(original, channel, pcm8),
      after = await render(changed, channel, pcm8);
    assert.deepEqual(
      after.audio,
      before.audio,
      "PCM metadata must not alter a single output sample"
    );
    if (!pcm8 || channel !== 8) assert.deepEqual(after.masks, before.masks);
    assert.deepEqual(after.changes, pcm8 ? [0, 97, 287] : [0, 1, 95]);
    assert.ok(after.heldBankChange);
    const muted = await render(changed, channel, pcm8, true);
    assert.deepEqual(muted.changes, []);
    assert.ok(muted.audio.every(n => n === 0));
    report.push({ pcm8, channel, changes: after.changes });
  }
const mixedBefore = await render(original, 8, true, false, true);
const mixedAfter = await render(changed, 8, true, false, true);
assert.deepEqual(
  mixedAfter.audio,
  mixedBefore.audio,
  "combined OPM and PCM output must be bit-identical"
);
console.log(
  JSON.stringify({
    bitIdentical: true,
    mixedFmPcm: true,
    heldBankChange: true,
    muted: true,
    report,
  })
);
