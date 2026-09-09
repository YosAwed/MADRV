import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4174";
const out = process.env.LOOP_REPORT_DIR ?? "/tmp/madrv-playlist-loop-edits";
await mkdir(out, { recursive: true });
const fixture = await readFile(new URL("../client/public/manus-storage/signal-deck-diagnostic_d91a1673.mdr", import.meta.url));
const table = fixture.indexOf(0, fixture.indexOf(0x1a) + 1) + 1;
const track = table + fixture.readUInt16BE(table + 2);
fixture[track + 4] = 0;
fixture[track + 6] = 0x7f;
const entries = ["First", "Second"].map((title, index) => ({
  id: `remote:loop-edit-${index}`, title, origin: "remote", format: "mdr", loopCount: 2,
  remoteMdrUrl: new URL(`/loop-edits/${index}.mdr`, baseUrl).href,
}));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
});
const report = { baseUrl, checks: [] };
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(entries => {
    if (!localStorage.getItem("madrv-player.playlist-v1")) localStorage.setItem("madrv-player.playlist-v1", JSON.stringify(entries));
    window.__nativeLoopStarts = [];
  }, entries);
  await page.route("https://raw.githubusercontent.com/**", route => route.abort());
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  // Observe arguments at the real WASM boundary without changing native playback.
  await page.route("**/madrv-mdx-player-*.mjs", async route => {
    const response = await route.fetch();
    const source = await response.text();
    assert.ok(source.includes("export default Module;"));
    await route.fulfill({ response, body: source.replace("export default Module;", `
      export default async options => new Proxy(await Module(options), {
        get(target, key) {
          if (key === '_mdx_player_play') return (...args) => {
            window.__nativeLoopStarts.push(args[0]);
            return target[key](...args);
          };
          return target[key];
        }
      });`) });
  });
  let held;
  let holdNext = false;
  await page.route("**/loop-edits/*.mdr", async route => {
    if (holdNext) {
      holdNext = false;
      await new Promise(resolve => { held = resolve; });
    }
    await route.fulfill({ contentType: "application/octet-stream", body: fixture });
  });
  const loops = index => page.getByTestId(`playlist-entry-${index}`).locator("..").locator('input[type="number"]');
  const waitStarts = count => page.waitForFunction(count => window.__nativeLoopStarts.length >= count, count, { timeout: 25000 });
  const starts = () => page.evaluate(() => window.__nativeLoopStarts);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByTestId("playlist-entry-0").click();
  await waitStarts(1);
  await loops(1).fill("3");
  await waitStarts(2);
  assert.deepEqual(await starts(), [2, 3], "Automatic advance must use the edited next-song count");
  report.checks.push("Editing the next song during playback passes 3, not the old 2, to native playback on automatic advance");

  await page.getByRole("button", { name: "停止", exact: true }).last().click();
  await page.getByTestId("playlist-entry-0").click();
  await waitStarts(3);
  await loops(0).fill("3");
  const change = page.getByTestId("playlist-loop-change-0");
  assert.match(await change.textContent(), /現在2回・次回3回/);
  assert.match(await page.getByTestId("playback-notice").textContent(), /2回ループ/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/active-loop-change-mobile.png`, fullPage: true });
  await change.getByRole("button", { name: "適用して最初から再生", exact: true }).click();
  await waitStarts(4);
  assert.deepEqual(await starts(), [2, 3, 2, 3]);
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-notice"]').textContent.includes("3回ループ"));
  assert.equal(await change.count(), 0);
  report.checks.push("Current playback and next count are distinguished; explicit restart applies 3 at the real native boundary");

  await page.getByRole("button", { name: "停止", exact: true }).last().click();
  holdNext = true;
  await page.getByTestId("playlist-entry-0").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "LOADING");
  await loops(0).fill("4");
  while (!held) await new Promise(resolve => setTimeout(resolve, 20));
  held();
  await waitStarts(5);
  assert.equal((await starts()).at(-1), 4);
  await page.getByRole("button", { name: "停止", exact: true }).last().click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await loops(0).inputValue(), "4");
  assert.equal(await loops(1).inputValue(), "3");
  report.checks.push("Edits during download apply to that start and both per-song counts persist after reload");
  report.errors = errors;
  assert.deepEqual(errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
