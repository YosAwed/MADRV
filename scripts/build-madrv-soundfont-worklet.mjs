/** Build the app scheduler around unchanged, pinned upstream worklet sources. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const taskRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const libEntry = require.resolve("spessasynth_lib");
const libDirectory = path.dirname(libEntry);
const libRequire = createRequire(libEntry);
const coreEntry = libRequire.resolve("spessasynth_core");
const libPackage = JSON.parse(await readFile(path.resolve(libDirectory, "../package.json"), "utf8"));
const corePackage = JSON.parse(await readFile(path.resolve(path.dirname(coreEntry), "../package.json"), "utf8"));
const mapBytes = await readFile(path.join(libDirectory, "spessasynth_processor.min.js.map"));
const mapHash = createHash("sha256").update(mapBytes).digest("hex");
if (libPackage.version !== "4.3.14" || corePackage.version !== "4.3.20"
  || mapHash !== "7ec50da7d39f360f49526483c20798915b420ed826711083f5638b5d8782064a") {
  throw new Error("SpessaSynth worklet source changed. Review adapter compatibility and update the pinned versions/source-map SHA-256 before building.");
}

const sourceMap = JSON.parse(mapBytes.toString("utf8"));
const vendorSources = new Map();
for (let index = 0; index < sourceMap.sources.length; index += 1) {
  const source = sourceMap.sources[index];
  if (!source.startsWith("../src/")) continue;
  const text = sourceMap.sourcesContent[index];
  if (typeof text !== "string") throw new Error(`Missing upstream source: ${source}`);
  vendorSources.set(source.slice("../src/".length), text);
}

const upstreamLicense = await readFile(path.resolve(libDirectory, "../LICENSE"), "utf8");
const banner = `/*!\nMADRV cancellable SoundFont scheduling adapter.\nIncludes unchanged spessasynth_lib 4.3.14 sources and spessasynth_core 4.3.20.\nUpstream: https://github.com/spessasus/spessasynth_lib\nhttps://github.com/spessasus/spessasynth_core\n${upstreamLicense.replaceAll("*/", "* /")}\n*/`;

await build({
  absWorkingDir: taskRoot,
  entryPoints: ["client/worklets/madrvSoundfontProcessor.ts"],
  outfile: path.join(taskRoot, "client/public/manus-storage/madrv-spessasynth-processor.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "inline",
  banner: { js: banner },
  plugins: [{
    name: "pinned-spessa-worklet-sources",
    setup(bundler) {
      bundler.onResolve({ filter: /^madrv-spessa-vendor\// }, args => ({
        path: args.path.slice("madrv-spessa-vendor/".length), namespace: "spessa-source-map",
      }));
      bundler.onResolve({ filter: /.*/, namespace: "spessa-source-map" }, args => {
        if (args.path === "spessasynth_core") return { path: coreEntry };
        if (!args.path.startsWith(".")) throw new Error(`Unexpected upstream import: ${args.path}`);
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
        return { path: resolved.endsWith(".ts") ? resolved : `${resolved}.ts`, namespace: "spessa-source-map" };
      });
      bundler.onLoad({ filter: /.*/, namespace: "spessa-source-map" }, args => {
        const contents = vendorSources.get(args.path);
        if (!contents) throw new Error(`Missing pinned upstream module: ${args.path}`);
        return { contents, loader: "ts" };
      });
    },
  }],
});
console.log("Built MADRV SoundFont worklet (pinned SpessaSynth + cancellable audio-clock scheduler).");
