import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4174";
const out = process.env.LIBRARY_REPORT_DIR ?? "/tmp/madrv-library-layout";
await mkdir(out, { recursive: true });

// Valid MDR framing with all 32 slots active: 8 OPM, 8 PCM, and 16 MIDI.
// This fixture exercises display routing without needing copyrighted songs.
const header = Buffer.from("Matrix 32-track diagnostic\r\n\x1aNONE\0");
const table = Buffer.alloc(66);
const tracks = Array.from({ length: 32 }, (_, index) => Buffer.from([
  ...(index === 0 ? [0xe0, 0xff] : []),
  0xe0, 0x08, index < 16 ? index : 0x80 + index - 16,
  0x80, 0x7f, 0xf1, 0,
]));
let offset = table.length;
tracks.forEach((track, index) => {
  table.writeUInt16BE(offset, 2 + index * 2);
  offset += track.length;
});
table.writeUInt16BE(offset, 0);
const fixture = Buffer.concat([header, table, ...tracks]);
const entries = Array.from({ length: 300 }, (_, index) => ({
  id: `remote:matrix-layout-${index}`, title: `${String(index + 1).padStart(3, "0")} · Playlist track`,
  origin: "remote", format: "mdr", loopCount: 2,
  remoteMdrUrl: new URL(`/matrix-layout/${index}.mdr`, baseUrl).href,
}));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const report = { baseUrl, checks: [], viewports: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", route => route.abort());
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(entries => {
    if (localStorage.getItem("madrv-player.playlist-v1") === null) {
      localStorage.setItem("madrv-player.playlist-v1", JSON.stringify(entries));
    }
  }, entries);
  const filters = page.getByRole("group", { name: "鍵盤の音源フィルター", exact: true });
  const filter = name => filters.getByRole("button", { name: `${name}を表示`, exact: true });
  const matrix = page.locator('[data-panel="matrix"]');
  const playlist = page.locator('[data-panel="playlist"]');
  async function loadFixture() {
    const settings = page.getByTestId("settings-toggle");
    if (await settings.getAttribute("aria-expanded") !== "true") await settings.click();
    await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
    await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles({ name: "matrix32.mdr", mimeType: "application/octet-stream", buffer: fixture });
    await page.getByTestId("source-title").filter({ hasText: "MATRIX32.MDR" }).waitFor();
    await settings.click();
  }
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await loadFixture();
  assert.equal(await page.getByTestId("playlist-entry-list").locator('[data-playlist-entry-id]').count(), 300);
  assert.equal(await matrix.locator('[data-keyboard-engine]').count(), 32);
  for (const [name, engine, count] of [["OPM", "opm", 8], ["PCM", "pcm", 8], ["MIDI", "midi", 16]]) {
    await filter(name).click();
    assert.equal(await matrix.locator('[data-keyboard-engine]').count(), count);
    assert.equal(await matrix.locator(`[data-keyboard-engine="${engine}"]`).count(), count);
  }
  await filter("OPM").click();
  await page.getByTestId("keyboard-track-0").getByRole("button", { name: "OPM 1のミュートをオンにする", exact: true }).click();
  await filter("MIDI").click();
  await filter("OPM").click();
  assert.equal(await page.getByTestId("keyboard-track-0").getByRole("button", { name: "OPM 1のミュートをオフにする", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByTestId("keyboard-track-0").getByRole("button", { name: "OPM 1のミュートをオフにする", exact: true }).click();
  report.checks.push("All 32 tracks filter to 8 OPM / 8 PCM / 16 MIDI; switching filters preserves mute state");

  await matrix.getByRole("button", { name: "音源別", exact: true }).click();
  await filter("PCM").click();
  assert.equal(await matrix.locator('[data-keyboard-engine="pcm"]').count(), 1);
  assert.equal(await matrix.locator('.matrix-pcm-pad').count(), 8);
  assert.equal(await matrix.getByTestId("track-full-keyboard").count(), 0);
  await filter("すべて").click();
  assert.equal(await matrix.locator('[data-keyboard-engine]').count(), 3);
  assert.equal(await matrix.getByTestId("track-full-keyboard").count(), 2);
  await matrix.getByRole("button", { name: "トラック別", exact: true }).click();
  report.checks.push("Engine view filters consistently, using activity pads for PCM and keyboards for OPM/MIDI");

  for (const width of [1366, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    const layout = await page.getByTestId("deck-library").boundingBox();
    const listBox = await playlist.boundingBox();
    const keysBox = await matrix.boundingBox();
    assert.ok(layout && listBox && keysBox);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
    if (layout.width >= 740) {
      assert.ok(Math.abs(listBox.y - keysBox.y) < 2 && listBox.x + listBox.width <= keysBox.x, `Panels are not side by side at ${width}`);
      assert.ok(listBox.y < 500 && keysBox.y < 500, "Long track/playlist content pushes either heading below the deck");
    } else {
      assert.ok(listBox.y + listBox.height <= keysBox.y, `Playlist is not above keyboards at ${width}`);
    }
    const keyScroll = page.getByTestId("keyboard-matrix-tracks");
    const listScroll = page.getByTestId("playlist-entry-list");
    const listTop = await listScroll.evaluate(el => el.scrollTop);
    await keyScroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal(await listScroll.evaluate(el => el.scrollTop), listTop);
    const keyTop = await keyScroll.evaluate(el => el.scrollTop);
    assert.ok(keyTop > 0, "Full track list should scroll inside its panel");
    await listScroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.equal(await keyScroll.evaluate(el => el.scrollTop), keyTop);
    assert.ok(await listScroll.evaluate(el => el.scrollTop > 0));
    await keyScroll.evaluate(el => { el.scrollTop = 0; });
    await listScroll.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${out}/library-${width}.png`, fullPage: true });
    report.viewports.push({ width, twoColumns: layout.width >= 740, playlist: listBox, keyboard: keysBox });
  }
  report.checks.push("300 playlist entries and 32 tracks remain in independent scrolling panels; wide screens use two columns and narrow screens put playlist first");

  await page.setViewportSize({ width: 1366, height: 900 });
  await playlist.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await page.getByTestId("deck-library").getAttribute("data-has-playlist"), "false");
  const full = await matrix.boundingBox();
  const deck = await page.getByTestId("program-deck").boundingBox();
  assert.ok(full && deck && Math.abs(full.width - deck.width) < 2, "Empty playlist should restore full-width keyboard");
  await page.screenshot({ path: `${out}/empty-playlist.png`, fullPage: true });
  await playlist.getByRole("button", { name: "Add current", exact: true }).click();
  assert.equal(await page.getByTestId("deck-library").getAttribute("data-has-playlist"), "true");
  assert.ok((await matrix.boundingBox()).width < deck.width * 0.6);
  report.checks.push("Clearing the playlist restores full keyboard width; adding a track switches back to two columns without reloading");

  await filter("MIDI").click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await filter("MIDI").getAttribute("aria-pressed"), "true");
  await loadFixture();
  assert.equal(await matrix.locator('[data-keyboard-engine="midi"]').count(), 16);
  report.checks.push("Engine filter preference persists across reload and source loading");
  assert.deepEqual(errors, []);
  report.errors = errors;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
