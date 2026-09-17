import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Original, generated FM test notes. No local music, PDX or user data is read
// or supplied to the remote origin by this deployment smoke test.
function syntheticMdx() {
  const title = Buffer.from("Staging synthetic test\r\n\x1a\0");
  const notes = Array.from({ length: 32 }, (_, i) => [0xb0 + [0, 4, 7, 12][i % 4], 47]).flat();
  const track = [0xff, 200, 0xfd, 0, 0xfc, 3, 0xfb, 10, ...notes, 0xf1, 0];
  const table = Buffer.alloc(20);
  const parts = [];
  let offset = 20;
  for (let i = 0; i < 9; i++) {
    table.writeUInt16BE(offset, 2 + i * 2);
    const part = Buffer.from(i === 0 ? track : [0xf1, 0]);
    parts.push(part);
    offset += part.length;
  }
  table.writeUInt16BE(offset, 0);
  const voice = Buffer.from([0, 7, 15, 1, 1, 1, 1, 127, 127, 127, 32, 31, 31, 31, 31, 0, 0, 0, 0, 0, 0, 0, 0, 15, 15, 15, 15]);
  return Buffer.concat([title, table, ...parts, voice]);
}

const origin = "https://madrv-player-staging.madrv-player-web.workers.dev";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(origin, { waitUntil: "networkidle" });
  const banner = await page.getByTestId("staging-banner").innerText();
  assert.match(banner, /検証環境/);
  assert.match(banner, /codex\//);
  const settings = page.getByTestId("settings-toggle");
  if (await settings.getAttribute("aria-expanded") !== "true") await settings.click();
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles({
    name: "STAGING-TEST.MDX", mimeType: "application/octet-stream", buffer: syntheticMdx(),
  });
  await page.getByLabel("マスター音量", { exact: true }).fill("0");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-seek"]')?.disabled === false);
  const slider = page.getByTestId("playback-seek");
  const duration = Number(await slider.getAttribute("max"));
  assert.ok(duration > 20 && duration < 30);
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "PLAYING"
    && Number(document.querySelector('[data-testid="playback-seek"]').value) > 10);
  const forward = Number(await slider.inputValue());
  await page.touchscreen.tap(bounds.x + bounds.width / 4, bounds.y + bounds.height / 2);
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "PLAYING"
    && Number(document.querySelector('[data-testid="playback-seek"]').value) < 8);
  const secondTap = Number(await slider.inputValue());
  assert.ok(Math.abs(secondTap - duration / 4) < 1);
  await slider.press("ArrowLeft");
  await page.waitForFunction(from => document.querySelector('[data-testid="playback-state"]').textContent === "PLAYING"
    && Number(document.querySelector('[data-testid="playback-seek"]').value) < from - 3, secondTap);
  const backward = Number(await slider.inputValue());
  await page.screenshot({ path: "/tmp/madrv-staging-browser.png", fullPage: true });
  await slider.press("End");
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "READY");
  assert.equal(Number(await slider.inputValue()), duration);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ origin, banner, fixture: "generated 163-byte MDX", touch: true, duration, forward, secondTap, backward, naturalEnd: true, pageErrors: errors }, null, 2));
} finally { await browser.close(); }
