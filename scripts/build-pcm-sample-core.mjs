import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const input = join(
  root,
  "client/public/manus-storage/madrv-mdx-player-v13_6e789f63.wasm"
);
assert.equal(
  createHash("sha256").update(readFileSync(input)).digest("hex"),
  "6e789f63c83e1688c07c1594e7477a241d3283e84dc4909c098020206c730b34"
);
const tool = name =>
  process.env.WABT_BIN ? join(process.env.WABT_BIN, name) : name;
const dir = mkdtempSync(join(tmpdir(), "madrv-pcm-sample-"));
try {
  const wat = join(dir, "core.wat"),
    wasm = join(dir, "core.wasm");
  execFileSync(tool("wasm2wat"), [input, "-o", wat]);
  let source = readFileSync(wat, "utf8");
  const start = source.indexOf("  (func (;46;)"),
    end = source.indexOf("\n  (func (;47;)", start);
  assert.ok(start > 0 && end > start);
  let fn = source.slice(start, end);
  const once = (from, to) => {
    assert.equal(fn.split(from).length, 2, from);
    fn = fn.replace(from, to);
  };
  // Audited v13 function 46: L000cbe sends key-ons. Only add diagnostic globals;
  // preserve every existing instruction and all audio/sequencer memory.
  const locals = fn.indexOf("\n", fn.indexOf("(local "));
  fn =
    fn.slice(0, locals) +
    "\n    (local $sampleIndex i32) (local $voiceIndex i32)" +
    fn.slice(locals);
  once(
    "      local.tee 5\n      i32.store\n      local.get 2\n      local.get 3\n      i32.load8_u offset=32",
    "      local.tee 5\n      i32.store\n      local.get 5\n      local.set $sampleIndex\n      local.get 2\n      local.get 3\n      i32.load8_u offset=32"
  );
  // PCM8 table byte offset = (bank * 96 + floor(raw note / 64)) * 8.
  once(
    "      local.tee 5\n      i32.store\n      local.get 2\n      local.get 5\n      local.get 7",
    "      local.tee 5\n      i32.store\n      local.get 5\n      i32.const 3\n      i32.shr_u\n      local.set $sampleIndex\n      local.get 2\n      local.get 5\n      local.get 7"
  );
  // Ordinary ADPCM: capture only after the actual output call, beyond size/address checks.
  once(
    "          call 71\n          local.get 0\n          i32.load\n          local.set 1",
    "          call 71\n          (call $rememberPcmSample (i32.const 0) (local.get $sampleIndex))\n          local.get 0\n          i32.load\n          local.set 1"
  );
  // PCM8: the second PCM8_SUB call starts the sample (the first just sets its mode).
  once(
    "      local.get 0\n      call 8\n      local.get 0\n      i32.load\n      local.tee 1\n      i32.const 1612",
    "      (local.set $voiceIndex (i32.and (i32.load (i32.load (local.get 0))) (i32.const 7)))\n      local.get 0\n      call 8\n      (call $rememberPcmSample (local.get $voiceIndex) (local.get $sampleIndex))\n      local.get 0\n      i32.load\n      local.tee 1\n      i32.const 1612"
  );
  source = source.slice(0, start) + fn + source.slice(end);
  const globals = Array.from(
    { length: 8 },
    (_, i) => `  (global $pcmSample${i} (mut i32) (i32.const -1))`
  ).join("\n");
  const setter = Array.from(
    { length: 8 },
    (_, i) =>
      `    (if (i32.eq (local.get 0) (i32.const ${i})) (then (global.set $pcmSample${i} (local.get 1))))`
  ).join("\n");
  const getter = Array.from(
    { length: 8 },
    (_, i) =>
      `    (if (i32.eq (local.get 0) (i32.const ${i})) (then (return (global.get $pcmSample${i}))))`
  ).join("\n");
  const additions = `\n  (func $rememberPcmSample (param i32 i32)\n${setter})\n  (func $getPcmSample (param i32) (result i32)\n${getter}\n    (i32.const -1))\n  (export "get_pcm_sample_number" (func $getPcmSample))
  ;; v13's mask checks sustained PCM8 voices 1..7 but omits voice 0.
  ;; Include its decoder's remaining data; preserve the original edge latches.
  (func $getPcmActivity (result i32) (local $mask i32) (local $ctx i32)
    (local.set $mask (call 109))
    (local.set $ctx (i32.load (i32.const 137224)))
    (if (i32.and (i32.ne (local.get $ctx) (i32.const 0)) (i32.ne (i32.load8_u (i32.const 137220)) (i32.const 0)))
      (then (if (call 20 (i32.add (local.get $ctx) (i32.const 2236)) (i32.const 0))
        (then (local.set $mask (i32.or (local.get $mask) (i32.const 1)))))))
    (local.get $mask))
  (export "get_pcm_activity_mask" (func $getPcmActivity))\n`;
  const stackGlobal = "  (global (;0;) (mut i32) (i32.const 5380624))";
  assert.ok(source.includes(stackGlobal));
  source = source.replace(stackGlobal, stackGlobal + "\n" + globals);
  source = source.replace("\n  (table (;0;)", additions + "\n  (table (;0;)");
  assert.ok(source.includes('(export "get_pcm_sample_number"'));
  writeFileSync(wat, source);
  execFileSync(tool("wat2wasm"), [wat, "-o", wasm]);
  const output = readFileSync(wasm),
    hash = createHash("sha256").update(output).digest("hex");
  const name = `madrv-mdx-player-v14_${hash.slice(0, 8)}.wasm`;
  writeFileSync(join(root, "client/public/manus-storage", name), output);
  console.log(JSON.stringify({ name, sha256: hash }));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
