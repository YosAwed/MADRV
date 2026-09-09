import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const out = process.env.CATALOG_REPORT_DIR ?? "/tmp/madrv-remote-catalog";
const storageKey = "madrv-player.playlist-v1";
const catalogUrl = new URL("/catalog-regression.json", baseUrl).href;
const entries = Array.from({ length: 300 }, (_, index) => {
  const number = String(index + 1).padStart(3, "0");
  return {
    id: `catalog-regression-${number}`,
    title: `Catalog regression ${number}`,
    mdrUrl: new URL(`/catalog-regression/${number}.mdr`, baseUrl).href,
  };
});
const report = { baseUrl, importedTracks: entries.length, viewports: [] };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  // A fresh browser context starts empty; no init script reseeds storage on reload.
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", route => route.abort());
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route(catalogUrl, route =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ entries }),
    })
  );
  const toggle = id => page.getByTestId(`panel-toggle-${id}`);
  const open = async id => {
    if ((await toggle(id).getAttribute("aria-expanded")) !== "true") {
      await toggle(id).click();
    }
  };
  const input = page.getByRole("textbox", {
    name: "リモートカタログJSONのURL",
    exact: true,
  });
  const source = page.getByRole("combobox", {
    name: "カタログの取得元",
    exact: true,
  });
  const load = page.getByRole("button", { name: "Load catalog", exact: true });
  const panel = page.locator('[data-panel="catalog"]');

  const verifyPlaylist = async stage => {
    await open("playlist");
    const rows = page
      .getByTestId("saved-playlist")
      .locator("[data-playlist-entry-id]");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '[data-testid="saved-playlist"] [data-playlist-entry-id]'
        ).length === 300,
      undefined,
      { timeout: 15_000 }
    );
    assert.deepEqual(
      await rows.evaluateAll(elements =>
        elements.map(element => element.getAttribute("data-playlist-entry-id"))
      ),
      entries.map(entry => `remote:${entry.id}`),
      `${stage}: all 300 playlist rows must retain their order`
    );
    await page.waitForFunction(
      key => JSON.parse(localStorage.getItem(key) ?? "[]").length === 300,
      storageKey,
      { timeout: 15_000 }
    );
    const saved = await page.evaluate(
      key => JSON.parse(localStorage.getItem(key) ?? "[]"),
      storageKey
    );
    assert.deepEqual(
      saved.map(({ id, title, remoteMdrUrl, origin, loopCount }) => ({
        id, title, remoteMdrUrl, origin, loopCount,
      })),
      entries.map(entry => ({
        id: `remote:${entry.id}`,
        title: entry.title,
        remoteMdrUrl: entry.mdrUrl,
        origin: "remote",
        loopCount: 2,
      })),
      `${stage}: saved tracks must retain their URLs and playback settings`
    );
    return saved.length;
  };

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await open("source");
  await page.getByRole("button", { name: "REMOTE URL", exact: true }).click();
  assert.equal(
    await toggle("catalog").getAttribute("aria-expanded"),
    "true",
    "The remote catalog URL field must be exposed by default"
  );
  await input.fill(catalogUrl);
  await load.click();
  report.savedBeforeReload = await verifyPlaylist("Before reload");
  await page.reload({ waitUntil: "networkidle" });
  report.savedAfterReload = await verifyPlaylist("After reload");
  await open("source");
  await page.getByRole("button", { name: "REMOTE URL", exact: true }).click();
  await open("catalog");

  for (const [width, height] of [
    [1366, 768],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.fill(catalogUrl);
    assert.equal(await input.inputValue(), catalogUrl);
    assert.equal(await input.isVisible(), true, `URL input hidden at ${width}`);
    const [inputBounds, sourceBounds, loadBounds, panelBounds] =
      await Promise.all([
        input.boundingBox(), source.boundingBox(), load.boundingBox(),
        panel.boundingBox(),
      ]);
    assert.ok(inputBounds && sourceBounds && loadBounds && panelBounds);
    assert.ok(
      inputBounds.width >= 140,
      `URL input is too narrow at ${width}: ${JSON.stringify(inputBounds)}`
    );
    for (const [name, bounds] of [
      ["URL input", inputBounds], ["Source selector", sourceBounds],
      ["Load catalog", loadBounds],
    ]) {
      assert.ok(
        bounds.x >= panelBounds.x - 1 &&
          bounds.y >= panelBounds.y - 1 &&
          bounds.x + bounds.width <= panelBounds.x + panelBounds.width + 1 &&
          bounds.y + bounds.height <= panelBounds.y + panelBounds.height + 1,
        `${name} overflows the catalog panel at ${width}`
      );
      assert.ok(
        bounds.x >= -1 && bounds.x + bounds.width <= width + 1,
        `${name} overflows the viewport at ${width}`
      );
    }
    const overlaps = (left, right) =>
      Math.min(left.x + left.width, right.x + right.width) -
        Math.max(left.x, right.x) > 1 &&
      Math.min(left.y + left.height, right.y + right.height) -
        Math.max(left.y, right.y) > 1;
    assert.equal(overlaps(inputBounds, sourceBounds), false,
      `URL input overlaps the source selector at ${width}`);
    assert.equal(overlaps(inputBounds, loadBounds), false,
      `URL input overlaps Load catalog at ${width}`);
    await page.screenshot({ path: `${out}/${width}-catalog.png`, fullPage: true });
    report.viewports.push({ width, height, inputBounds, sourceBounds, loadBounds });
  }
  report.errors = errors;
  assert.deepEqual(errors, [], "Unexpected browser errors");
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
