import assert from "node:assert/strict";
import { chromium, webkit } from "playwright-core";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Generated original notes only: safe for local or staging verification.
function mdx(title, bank = "") {
  const header = Buffer.from(`${title}\r\n\x1a${bank}\0`);
  const table = Buffer.alloc(20);
  const parts = [];
  let offset = 20;
  for (let channel = 0; channel < 9; channel++) {
    table.writeUInt16BE(offset, 2 + channel * 2);
    const part = Buffer.from(channel === 0 ? [0xff,200,0xfd,0,0xfc,3,0xfb,10,0xb0,47,0xb4,47,0xb7,47,0xf1,0] : [0xf1,0]);
    parts.push(part); offset += part.length;
  }
  table.writeUInt16BE(offset, 0);
  return Buffer.concat([header, table, ...parts, Buffer.from([0,7,15,1,1,1,1,127,127,127,32,31,31,31,31,0,0,0,0,0,0,0,0,15,15,15,15])]);
}
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "madrv-selection-"));
const album = path.join(fixtureRoot, "album");
const singleFolder = path.join(fixtureRoot, "one-song");
await mkdir(album);
await mkdir(singleFolder);
await writeFile(path.join(album, "FIRST.MDX"), mdx("First folder song"));
await writeFile(path.join(album, "SECOND.MDX"), mdx("Second folder song"));
await writeFile(path.join(singleFolder, "ONLY.MDX"), mdx("One song folder"));
const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const browser = process.env.MADRV_BROWSER === "webkit" ? await webkit.launch({ headless: true }) : await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36" });
  if (new URL(baseUrl).hostname === "127.0.0.1") await page.route("**/manus-storage/*.mjs*", async route => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({ contentType: "text/javascript", body: await readFile(new URL(`../client/public/manus-storage/${name}`, import.meta.url)) });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const settings = page.getByTestId("settings-toggle");
  if (await settings.getAttribute("aria-expanded") !== "true") await settings.tap();
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).tap();
  // Prove taps use browser-native activation, even if JS .click() cannot open
  // a file picker. This reproduces a blocked forwarding path, not Android OS UI.
  await page.evaluate(() => {
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === "file") throw new Error("Programmatic file-input click must not be used");
      return click.call(this);
    };
  });
  const fileButton = page.getByTestId("select-local-file");
  const folderButton = page.getByTestId("select-local-folder");
  const notice = page.getByTestId("playback-notice");
  const playlistCount = () => page.locator('[data-testid^="playlist-entry-title-"]').count();
  const choose = async (button, directory, files) => {
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.tap()]);
    const element = chooser.element();
    assert.equal(await element.getAttribute("webkitdirectory") !== null, directory);
    assert.equal(await element.getAttribute("data-testid"), directory ? "local-folder-input" : "local-file-input");
    await chooser.setFiles(files);
  };
  const dropzone = page.getByTestId("local-file-dropzone");
  await dropzone.scrollIntoViewIfNeeded();
  const arrow = await dropzone.locator("svg").boundingBox();
  const point = { x: arrow.x + arrow.width / 2, y: arrow.y + arrow.height / 2 };
  assert.equal(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.getAttribute("data-testid"), point), "local-file-input");
  const [arrowChooser] = await Promise.all([page.waitForEvent("filechooser"), page.touchscreen.tap(point.x, point.y)]);
  assert.equal(await arrowChooser.element().getAttribute("webkitdirectory"), null);
  await arrowChooser.setFiles({ name: "SINGLE.MDX", mimeType: "application/octet-stream", buffer: mdx("Single selection") });
  await notice.filter({ hasText: /MDX「SINGLE.MDX」を読込みました/ }).waitFor();
  assert.equal(await playlistCount(), 0, "Single file must not become a playlist");
  await choose(folderButton, true, album);
  await notice.filter({ hasText: /ローカルフォルダから2曲/ }).waitFor();
  assert.equal(await playlistCount(), 2);
  await choose(fileButton, false, path.join(album, "FIRST.MDX"));
  await notice.filter({ hasText: /MDX「FIRST.MDX」を読込みました/ }).waitFor();
  assert.equal(await playlistCount(), 2, "Selecting a file inside a folder must not import its siblings");
  await choose(folderButton, true, singleFolder);
  await notice.filter({ hasText: /ローカルフォルダから1曲/ }).waitFor();
  assert.equal(await playlistCount(), 3, "A one-song folder must still be treated as a folder");
  await choose(fileButton, false, [
    { name: "PAIRED.MDX", mimeType: "application/octet-stream", buffer: mdx("Paired file", "BANK") },
    { name: "BANK.PDX", mimeType: "application/octet-stream", buffer: Buffer.alloc(768) },
  ]);
  await notice.filter({ hasText: /PDX「BANK.PDX」を自動選択/ }).waitFor();
  assert.equal(await playlistCount(), 3);
  const beforeCancel = await notice.innerText();
  await page.getByTestId("local-folder-input").evaluate(input => {
    input.files = new DataTransfer().files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await notice.innerText(), beforeCancel, "Cancelling must leave the loaded source unchanged");
  const input = page.getByTestId("local-file-input");
  await input.focus();
  const [keyboardChooser] = await Promise.all([page.waitForEvent("filechooser"), input.press("Space")]);
  await keyboardChooser.setFiles({ name: "KEYBOARD.MDX", mimeType: "application/octet-stream", buffer: mdx("Keyboard selection") });
  await notice.filter({ hasText: /MDX「KEYBOARD.MDX」を読込みました/ }).waitFor();
  await input.evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "DROP.MDX"));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, [...mdx("Dropped file")]);
  await notice.filter({ hasText: /MDX「DROP.MDX」を読込みました/ }).waitFor();
  assert.equal(await playlistCount(), 3);
  assert.deepEqual(errors, []);
  await fileButton.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/madrv-local-selection.png", fullPage: true });
  console.log(JSON.stringify({ baseUrl, browser: process.env.MADRV_BROWSER ?? "chromium", nativeArrowTap: true,
    programmaticClickBlocked: true, filePicker: true, folderPicker: true, singleFile: true,
    folderPlaylist: true, oneSongFolder: true, pdxPair: true, cancellation: true, keyboard: true, drop: true, errors }, null, 2));
} finally { await browser.close(); }
