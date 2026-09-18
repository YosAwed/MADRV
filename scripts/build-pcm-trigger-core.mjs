import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = join(root, 'client/public/manus-storage/madrv-mdx-player-v15_6c603674.wasm');
assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'), '6c603674d2119458d8badcaf71716db25656249a8f8fa5cea68a881d71280438');
const tool = name => process.env.WABT_BIN ? join(process.env.WABT_BIN, name) : name;
const dir = mkdtempSync(join(tmpdir(), 'madrv-pcm-trigger-'));
try {
  const wat = join(dir, 'core.wat'), wasm = join(dir, 'core.wasm');
  execFileSync(tool('wasm2wat'), [input, '-o', wat]);
  let source = readFileSync(wat, 'utf8');
  // The existing sample latch is called only after actual ADPCM/PCM8 key-ons.
  // Add independent diagnostic counters; never write audio or sequencer memory.
  const start = source.indexOf('  (func (;166;)'), end = source.indexOf('\n  (func (;167;)', start);
  assert.ok(start > 0 && end > start);
  const fn = source.slice(start, end);
  assert.equal((fn.match(/global.set/g) ?? []).length, 8);
  const newline = fn.indexOf('\n');
  source = source.slice(0, start) + fn.slice(0, newline) + '\n    (call $rememberPcmTrigger (local.get 0))' + fn.slice(newline) + source.slice(end);
  const globals = Array.from({length:8}, (_,i) => `  (global $pcmTrigger${i} (mut i32) (i32.const 0))`).join('\n');
  const block = source.match(/(?:  \(global [^\n]+\)\n)+/)[0];
  assert.equal(block.split('\n').filter(Boolean).length, 17);
  source = source.replace(block, block + globals + '\n');
  const setter = Array.from({length:8}, (_,i) => `    (if (i32.eq (local.get 0) (i32.const ${i})) (then (global.set $pcmTrigger${i} (i32.add (global.get $pcmTrigger${i}) (i32.const 1)))))`).join('\n');
  const getter = Array.from({length:8}, (_,i) => `    (if (i32.eq (local.get 0) (i32.const ${i})) (then (return (global.get $pcmTrigger${i}))))`).join('\n');
  source = source.replace('\n  (table (;0;)', `\n  (func $rememberPcmTrigger (param i32)\n${setter})\n  (func $getPcmTrigger (param i32) (result i32)\n${getter}\n    (i32.const 0))\n  (export "get_pcm_trigger_count" (func $getPcmTrigger))\n\n  (table (;0;)`);
  writeFileSync(wat, source);
  execFileSync(tool('wat2wasm'), [wat, '-o', wasm]);
  const output = readFileSync(wasm), hash = createHash('sha256').update(output).digest('hex');
  const name = `madrv-mdx-player-v16_${hash.slice(0,8)}.wasm`;
  writeFileSync(join(root, 'client/public/manus-storage', name), output);
  console.log(JSON.stringify({name,sha256:hash}));
} finally { rmSync(dir, {recursive:true,force:true}); }
