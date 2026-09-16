import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const action = process.argv[2] ?? "--build-only";
assert.ok(["--build-only", "--dry-run", "--deploy"].includes(action) && process.argv.length <= 3,
  "Use --build-only, --dry-run or --deploy. Deployment target overrides are not accepted.");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const branch = git("branch", "--show-current");
assert.ok(branch.startsWith("codex/"), "Staging builds must run from a codex/ development branch, never main or a detached checkout.");
const configFile = path.join(root, "wrangler.staging.jsonc");
const config = JSON.parse(readFileSync(configFile, "utf8"));
assert.equal(config.name, "madrv-player-staging");
assert.equal(config.account_id, "349436871b6d236eb4ede3c2c625770f");
assert.equal(config.assets.directory, "./dist/staging/public");
assert.deepEqual(config.routes, []);
assert.equal(config.route, undefined);
assert.equal(config.env, undefined);
assert.deepEqual(config.durable_objects.bindings, [{ name: "SESSIONS", class_name: "SessionStore" }],
  "Staging sessions must bind to this Worker's own class, not a production script/namespace.");
const revision = git("rev-parse", "--short=12", "HEAD");
const dirty = git("status", "--porcelain").length > 0;
const build = { environment: "staging", worker: config.name, branch, revision, dirty, builtAt: new Date().toISOString() };
const env = { ...process.env, CLOUDFLARE_BUILD: "1", VITE_BUILD_BRANCH: branch, VITE_BUILD_REVISION: `${revision}${dirty ? "-dirty" : ""}`, CLOUDFLARE_SEND_METRICS: "false" };
// Do not let shell environment selection/account defaults redirect this command.
delete env.CLOUDFLARE_ENV;
env.CLOUDFLARE_ACCOUNT_ID = config.account_id;
const run = args => execFileSync("pnpm", args, { cwd: root, env, stdio: "inherit" });
console.log(`Building ${branch} (${env.VITE_BUILD_REVISION}) for ${config.name}.`);
run(["build:soundfont-worklet"]);
run(["exec", "vite", "build", "--mode", "staging", "--outDir", "../dist/staging/public"]);
const out = path.join(root, config.assets.directory);
writeFileSync(path.join(out, "build-info.json"), `${JSON.stringify(build, null, 2)}\n`);
writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
writeFileSync(path.join(out, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n/build-info.json\n  Cache-Control: no-store\n");
if (action !== "--build-only") {
  run(["exec", "wrangler", "deploy", "--config", configFile, "--env", "", ...(action === "--dry-run" ? ["--dry-run"] : [])]);
}
