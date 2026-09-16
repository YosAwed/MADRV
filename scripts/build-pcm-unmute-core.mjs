import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Offline, surgical rebuild from the checked-in core. Requires WABT 1.0.39
// wasm2wat/wat2wasm on PATH, or WABT_BIN pointing to their directory.
// No upstream source or unrelated WASM function is changed.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = join(root, "client/public/manus-storage/madrv-mdx-player-v12_2d6b7625.wasm");
const original = readFileSync(input);
const hash = createHash("sha256").update(original).digest("hex");
if (hash !== "12331150d43b8010544363e6678ae5e01184c2eb5d5c107d07f02fa11ad578f0") {
  throw new Error("PCM unmute patch requires the audited v12 core; re-audit its layout before upgrading.");
}
const directory = mkdtempSync(join(tmpdir(), "madrv-pcm-core-"));
const tool = name => process.env.WABT_BIN ? join(process.env.WABT_BIN, name) : name;
try {
  const wat = join(directory, "player.wat");
  const wasm = join(directory, "player.wasm");
  execFileSync(tool("wasm2wat"), [input, "-o", wat]);
  const source = readFileSync(wat, "utf8");
  const start = source.indexOf("  (func (;148;)");
  const end = source.indexOf("\n  (func (;149;)", start);
  if (start < 0 || end < 0 || !source.includes('(export "t" (func 148))')) {
    throw new Error("Unexpected v12 channel-mask function/export.");
  }
  const patch = readFileSync(join(root, "client/wasm/pcm-unmute-channel-mask.wat"), "utf8");
  writeFileSync(wat, source.slice(0, start) + patch.trimEnd() + source.slice(end));
  execFileSync(tool("wat2wasm"), [wat, "-o", wasm]);
  const output = readFileSync(wasm);
  const suffix = createHash("sha256").update(output).digest("hex").slice(0, 8);
  const name = `madrv-mdx-player-v13_${suffix}.wasm`;
  writeFileSync(join(root, "client/public/manus-storage", name), output);
  console.log(`Built ${name}: cancels pending PCM key-ons on unmute.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
