import assert from "node:assert/strict";
import { chromium, webkit } from "playwright-core";

// Original one-voice MDX: short drum hits and rests are all inside the mobile
// 16384-frame buffer. End-of-buffer sampling wrongly joins the rests together.
const header = Buffer.from("Single ADPCM display\r\n\x1aSINGLE\0");
const table = Buffer.alloc(20);
const tracks = Array.from({ length: 9 }, (_, index) => Buffer.from(index === 8
  ? [0xfc, 3, 0xfb, 15, 0xed, 4, ...Array.from({ length: 96 }, (_, n) => [0x80 + n % 2, 3, 7]).flat(), 0xf1, 0]
  : [0xf1, 0]));
let offset = table.length;
tracks.forEach((track, index) => { table.writeUInt16BE(offset, 2 + index * 2); offset += track.length; });
table.writeUInt16BE(offset, 0);
const mdx = Buffer.concat([header, table, ...tracks]);
const pdx = Buffer.alloc(768 + 2048);
for (let n = 0; n < 2; n++) {
  pdx.writeUInt32BE(768 + n * 1024, n * 8);
  pdx.writeUInt32BE(1024, n * 8 + 4);
}
for (let n = 768; n < pdx.length; n++) pdx[n] = n % 16 < 8 ? 0x11 : 0x99;
const browser = process.env.MADRV_BROWSER === "webkit"
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4173";
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const settings = page.getByTestId("settings-toggle");
  if (await settings.getAttribute("aria-expanded") !== "true") await settings.click();
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles([
    { name: "SINGLE.MDX", mimeType: "application/octet-stream", buffer: mdx },
    { name: "SINGLE.PDX", mimeType: "application/octet-stream", buffer: pdx },
  ]);
  const strip = page.getByTestId("pcm-activity-strip").first();
  await strip.waitFor();
  await page.getByLabel("マスター音量", { exact: true }).fill("0");
  await settings.click();
  // Retain every reported transition between slower screenshot paints.
  await page.evaluate(() => {
    window.pcmDisplayCheck = { on: 0, off: 0, numbers: [] };
    const element = document.querySelector('[data-testid="pcm-activity-strip"]');
    new MutationObserver(() => {
      const state = window.pcmDisplayCheck;
      state[element.getAttribute("data-active") === "true" ? "on" : "off"]++;
      const number = element.querySelector('[data-sample-number]')?.getAttribute("data-sample-number");
      if (number && !state.numbers.includes(number)) state.numbers.push(number);
    }).observe(element, { subtree: true, attributes: true, attributeFilter: ["data-active", "data-sample-number"] });
  });
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="playback-seek"]').value) >= 5);
  const metrics = await page.evaluate(() => ({
    ...window.pcmDisplayCheck,
    rows: document.querySelectorAll('[data-testid="pcm-activity-strip"]').length,
    ranges: document.querySelectorAll('[data-pcm-hit]').length,
  }));
  console.log(JSON.stringify({ baseUrl, ...metrics, errors }));
  if (process.env.MADRV_DIAGNOSE !== "1") {
    assert.equal(metrics.rows, 1, "ordinary MDX has only one ADPCM voice");
    assert.ok(metrics.off >= 5, "short rests must survive the mobile audio buffer");
    assert.ok(metrics.ranges >= 5, "history must contain separate hits rather than one continuous bar");
    assert.ok(metrics.numbers.includes("0") && metrics.numbers.includes("1"));
    assert.deepEqual(errors, []);
    await page.getByTestId("keyboard-track-8").screenshot({ path: `/tmp/madrv-single-adpcm-${process.env.MADRV_BROWSER ?? "chromium"}.png` });
    await page.getByLabel("停止", { exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-pcm-hit]').length === 0);
  }
} finally {
  await browser.close();
}
