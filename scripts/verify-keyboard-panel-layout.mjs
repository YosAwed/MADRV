import { chromium, webkit } from "playwright-core";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const title = Buffer.from("Keyboard spacing test\r\n\x1a\0");
const table = Buffer.alloc(20);
let offset = 20;
const parts = [];
for (let i = 0; i < 9; i++) {
  table.writeUInt16BE(offset, 2 + i * 2);
  const part = Buffer.from(
    i < 8
      ? [0xff, 200, 0xfd, 0, 0xfc, 3, 0xfb, 10, 0xb0 + i, 95, 0xf1, 0]
      : [0xf1, 0]
  );
  parts.push(part);
  offset += part.length;
}
table.writeUInt16BE(offset, 0);
const voice = Buffer.from([
  0, 7, 15, 1, 1, 1, 1, 127, 127, 127, 32, 31, 31, 31, 31, 0, 0, 0, 0, 0, 0, 0,
  0, 15, 15, 15, 15,
]);
const mdx = Buffer.concat([title, table, ...parts, voice]);
const browser =
  process.env.MADRV_BROWSER === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
      });
const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const report = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const settings = page.getByTestId("settings-toggle");
  if ((await settings.getAttribute("aria-expanded")) !== "true")
    await settings.click();
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  // Original generated notes only; no personal music files are read.
  await page
    .locator('input[type="file"][accept*=".mdx"]')
    .setInputFiles({
      name: "SPACING.MDX",
      mimeType: "application/octet-stream",
      buffer: mdx,
    });
  await page.getByTestId("keyboard-track-0").waitFor();
  for (const playlist of [false, true]) {
    if (playlist)
      await page
        .getByRole("button", { name: "Add current", exact: true })
        .click();
    for (const width of [320, 390, 768, 1024, 1280, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const settingsOpen of [false, true]) {
        if (
          ((await settings.getAttribute("aria-expanded")) === "true") !==
          settingsOpen
        )
          await settings.click();
        for (const mode of ["トラック別", "音源別"]) {
          await page.getByRole("button", { name: mode, exact: true }).click();
          const geometry = await page
            .locator('[data-panel="matrix"]')
            .evaluate(panel => {
              const box = e => {
                const r = e.getBoundingClientRect();
                return {
                  left: r.left,
                  right: r.right,
                  top: r.top,
                  bottom: r.bottom,
                  width: r.width,
                  height: r.height,
                };
              };
              return {
                pageWidth: document.documentElement.scrollWidth,
                panel: box(panel),
                keyboards: [
                  ...panel.querySelectorAll(
                    '[data-testid="track-full-keyboard"]'
                  ),
                ].map(k => ({
                  keyboard: box(k),
                  row: box(k.parentElement),
                  buttons: [...k.parentElement.querySelectorAll("button")].map(
                    box
                  ),
                })),
              };
            });
          const label = JSON.stringify({ playlist, width, settingsOpen, mode });
          assert.equal(geometry.pageWidth, width, label + " page overflow");
          assert.equal(
            geometry.keyboards.length,
            mode === "トラック別" ? 8 : 1,
            label
          );
          for (const { keyboard: k, row, buttons } of geometry.keyboards) {
            assert.ok(
              k.width >= row.width / 2,
              label + " keyboard squeezed to less than half row width"
            );
            assert.ok(
              k.left >= geometry.panel.left && k.right <= geometry.panel.right,
              label + " keyboard outside panel"
            );
            for (const b of buttons) {
              assert.ok(
                b.width >= 30 && b.height >= 38,
                label + " shrunken controls"
              );
              assert.ok(
                b.right <= geometry.panel.right,
                label + " button outside panel"
              );
              assert.ok(
                k.right <= b.left ||
                  k.left >= b.right ||
                  k.bottom <= b.top ||
                  k.top >= b.bottom,
                label + " keyboard overlaps control"
              );
            }
          }
          report.push({
            playlist,
            width,
            settingsOpen,
            mode,
            rowHeight: geometry.keyboards[0].row.height,
            keyboardWidth: geometry.keyboards[0].keyboard.width,
          });
          if (playlist && width === 1366 && mode === "トラック別")
            await page
              .locator('[data-panel="matrix"]')
              .screenshot({
                path: `/tmp/madrv-pc-fixed-settings-${settingsOpen}.png`,
              });
        }
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 900 });
  if ((await settings.getAttribute("aria-expanded")) === "true")
    await settings.click();
  await page.getByRole("button", { name: "トラック別", exact: true }).click();
  for (const button of await page
    .getByTestId("keyboard-track-0")
    .getByRole("button")
    .all()) {
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    await button.tap();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    await button.tap();
    assert.equal(await button.getAttribute("aria-pressed"), "false");
  }
  await page
    .locator('[data-panel="matrix"]')
    .screenshot({ path: "/tmp/madrv-mobile-panel-fixed.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    "/tmp/madrv-keyboard-panel-report.json",
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify({
      baseUrl,
      cases: report.length,
      errors,
      mobile: report.find(
        r =>
          r.width === 390 &&
          !r.playlist &&
          !r.settingsOpen &&
          r.mode === "トラック別"
      ),
      desktopSplit: report.find(
        r =>
          r.width === 1366 &&
          r.playlist &&
          !r.settingsOpen &&
          r.mode === "トラック別"
      ),
    })
  );
} finally {
  await browser.close();
}
