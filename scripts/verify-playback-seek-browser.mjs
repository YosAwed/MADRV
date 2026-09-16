import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const [mdx, pdx] = process.argv.slice(2);
if (!mdx) throw new Error("Usage: node scripts/verify-playback-seek-browser.mjs /path/to/song.mdx [/path/to/bank.pdx]");
const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
let page;
try {
  page = await browser.newPage({ viewport: process.env.MADRV_MOBILE === "1" ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: process.env.MADRV_MOBILE === "1", isMobile: process.env.MADRV_MOBILE === "1" });
  // Vite's dev import transformer rejects dynamic modules inside public/.
  // Serve these exact bundled modules as static files, as the built app does.
  await page.route("**/manus-storage/*.mjs*", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(`../client/public/manus-storage/${name}`, import.meta.url)) });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType("resource").find(entry => entry.name.includes("/src/lib/madrvEngine.ts"))?.name;
    if (!moduleUrl) throw new Error("Expected the Vite development engine module");
    const { SignalDeckAudio } = await import(moduleUrl);
    window.seekChecks = { count: 0 };
    const original = SignalDeckAudio.prototype.seekTo;
    SignalDeckAudio.prototype.seekTo = function (seconds) {
      window.seekChecks.count++;
      window.seekChecks.engine = this;
      return original.call(this, seconds);
    };
  });
  const settings = page.getByTestId("settings-toggle");
  if (await settings.getAttribute("aria-expanded") !== "true") await settings.click();
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles([mdx, ...(pdx ? [pdx] : [])]);
  await page.getByLabel("マスター音量", { exact: true }).fill("0");
  const slider = page.getByTestId("playback-seek");
  assert.equal(await slider.isDisabled(), true);
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="playback-seek"]').disabled);
  const duration = Number(await slider.getAttribute("max"));
  assert.ok(duration > 10, "Use a fixture longer than 10 seconds");
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds.x + 8, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height / 2, { steps: 8 });
  assert.equal(await page.evaluate(() => window.seekChecks.count), 0, "Dragging must not repeatedly seek");
  await page.mouse.up();
  await page.waitForFunction(() => window.seekChecks.count === 1 && !document.querySelector('[data-testid="playback-seek"]').disabled);
  const forward = Number(await slider.inputValue());
  assert.ok(Math.abs(forward / duration - 0.4) < 0.08, `Forward position: ${forward}/${duration}`);
  await slider.press("ArrowLeft");
  await page.waitForFunction(() => window.seekChecks.count === 2 && !document.querySelector('[data-testid="playback-seek"]').disabled);
  const backward = Number(await slider.inputValue());
  assert.ok(backward < forward - 3, "Keyboard seek must move backwards");
  await page.screenshot({ path: "/tmp/madrv-playback-seek-playing.png", fullPage: true });
  await slider.press("Home");
  await page.waitForFunction(() => window.seekChecks.count === 3 && !document.querySelector('[data-testid="playback-seek"]').disabled);
  assert.ok(Number(await slider.inputValue()) < 1);
  await slider.press("End");
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "READY", undefined, { timeout: 15_000 });
  assert.equal(Number(await slider.inputValue()), Number(await slider.getAttribute("max")));
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="playback-seek"]').disabled);
  // Stretch preparation to make cancellation deterministic on fast machines.
  await page.evaluate(() => {
    const player = window.seekChecks.engine.mdrPlayer;
    const render = player.renderInto.bind(player);
    player.renderInto = (...args) => {
      const until = performance.now() + 2;
      while (performance.now() < until) { /* test-only synthetic work */ }
      return render(...args);
    };
  });
  await slider.press("End");
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "SEEKING");
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "READY");
  await page.waitForTimeout(500);
  assert.equal(Number(await slider.inputValue()), 0);
  assert.equal(await page.evaluate(() => window.seekChecks.engine.canSeek()), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/madrv-playback-seek.png", fullPage: true });
  console.log(JSON.stringify({ duration, forward, backward, dragCommitsOnce: true, keyboard: true, naturalEnd: true, cancelledSeek: true, pageErrors: errors }, null, 2));
} catch (error) {
  if (page) {
    console.error(await page.locator("body").innerText());
    console.error(await page.evaluate(() => ({ seekCount: window.seekChecks?.count })));
    await page.screenshot({ path: "/tmp/madrv-playback-seek-failed.png", fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
