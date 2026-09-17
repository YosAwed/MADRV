import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const input = join(root, 'client/public/manus-storage/madrv-mdx-player-v14_09c287f0.wasm');
assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'), '09c287f0373a3edcad9181bbc26ca2526c644c1c1a7003c508865761eb8cf8da');
const tool = name => process.env.WABT_BIN ? join(process.env.WABT_BIN, name) : name;
const dir = mkdtempSync(join(tmpdir(), 'madrv-pcm-pan-'));
try {
  const wat = join(dir, 'core.wat'), wasm = join(dir, 'core.wasm');
  execFileSync(tool('wasm2wat'), [input, '-o', wat]);
  let source = readFileSync(wat, 'utf8');
  const start = source.indexOf('  (func (;46;)'), end = source.indexOf('\n  (func (;47;)', start);
  let fn = source.slice(start, end);
  const once = (from, to) => { assert.equal(fn.split(from).length, 2, from); fn = fn.replace(from, to); };
  // v14's two appended locals are indices 9 and 10. Preserve all old indices.
  const localsEnd = fn.indexOf('\n', fn.indexOf('(local '));
  fn = fn.slice(0, localsEnd) + '\n    (local $panMode i32)' + fn.slice(localsEnd);
  // ADPCMOUT receives its final mode in local 2. Its low bits and PCM8's low
  // mode bits both map 1=left, 2=right, 3=both, 0=neither (audited PANTBL).
  once('          call 71\n          i32.const 0', '          call 71\n          (call $rememberPcmPan (i32.const 0) (local.get 2))\n          i32.const 0');
  // Capture PCM8's final output mode before PCM8_SUB changes working registers.
  once('      local.get 1\n      local.get 3\n      i32.or\n      i32.store offset=4\n      local.get 0\n      call 8',
       '      local.get 1\n      local.get 3\n      i32.or\n      local.tee $panMode\n      i32.store offset=4\n      local.get 0\n      call 8');
  once('      local.get 10\n      local.get 9\n      call 166', '      (call $rememberPcmPan (local.get 10) (local.get $panMode))\n      local.get 10\n      local.get 9\n      call 166');
  source = source.slice(0, start) + fn + source.slice(end);
  const globals = Array.from({ length: 8 }, (_, i) => `  (global $pcmPan${i} (mut i32) (i32.const -1))`).join('\n');
  const globalBlock = source.match(/(?:  \(global [^\n]+\)\n)+/)[0];
  assert.equal(globalBlock.split('\n').filter(Boolean).length, 9);
  source = source.replace(globalBlock, globalBlock + globals + '\n');
  const setter = Array.from({ length: 8 }, (_, i) => `    (if (i32.eq (local.get 0) (i32.const ${i})) (then (global.set $pcmPan${i} (i32.and (local.get 1) (i32.const 3)))))`).join('\n');
  const getter = Array.from({ length: 8 }, (_, i) => `    (if (i32.eq (local.get 0) (i32.const ${i})) (then (return (global.get $pcmPan${i}))))`).join('\n');
  const additions = `\n  (func $rememberPcmPan (param i32 i32)\n${setter})\n  (func $getPcmPan (param i32) (result i32)\n${getter}\n    (i32.const -1))\n  (export "get_pcm_pan" (func $getPcmPan))\n`;
  source = source.replace('\n  (table (;0;)', additions + '\n  (table (;0;)');
  writeFileSync(wat, source);
  execFileSync(tool('wat2wasm'), [wat, '-o', wasm]);
  const output = readFileSync(wasm), hash = createHash('sha256').update(output).digest('hex');
  const name = `madrv-mdx-player-v15_${hash.slice(0, 8)}.wasm`;
  writeFileSync(join(root, 'client/public/manus-storage', name), output);
  console.log(JSON.stringify({ name, sha256: hash }));
} finally { rmSync(dir, { recursive: true, force: true }); }
