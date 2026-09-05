import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const out = process.env.HELP_REPORT_DIR ?? "/tmp/madrv-help-ui";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const report = { baseUrl, checks: [], errors: [] };
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
try {
  for (const touch of [false, true]) {
    const page = await browser.newPage({
      viewport: touch
        ? { width: 390, height: 844 }
        : { width: 1366, height: 768 },
      hasTouch: touch,
    });
    page.on("pageerror", error => report.errors.push(error.message));
    await page.route("https://raw.githubusercontent.com/**", route =>
      route.abort()
    );
    await page.route("https://fonts.googleapis.com/**", route => route.abort());
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const content = page.locator('[data-slot="tooltip-content"]');
    const help = label =>
      page.getByRole("button", { name: `${label}の説明`, exact: true });
    const openPanel = async id => {
      const button = page.getByTestId(`panel-toggle-${id}`);
      if ((await button.getAttribute("aria-expanded")) !== "true")
        await button.click();
    };
    const showHelp = async label => {
      if (touch) await help(label).tap();
      else await help(label).hover();
      await content.waitFor({ state: "visible" });
      await page.waitForTimeout(350);
      assert(
        await content.isVisible(),
        "Tooltip did not remain open for reading"
      );
    };
    const dismiss = async () => {
      await page.keyboard.press("Escape");
      await content.waitFor({ state: "hidden" });
      await page.mouse.move(0, 0);
    };
    const bodyText = await page.locator("body").innerText();
    assert(
      !bodyText.includes("音源をデッキへ送る"),
      "Bulky source headline is visible"
    );
    assert(
      !bodyText.includes("GS向けSF2/DLSをローカルから"),
      "SoundFont instructions visible by default"
    );
    assert(
      !bodyText.includes("MDR／MDXとPDXは同時選択"),
      "Local source instructions visible by default"
    );
    assert((await content.count()) === 0, "Tooltip open on initial load");
    let pickerOpened = false;
    page.on("filechooser", () => {
      pickerOpened = true;
    });
    const before = await page.getByTestId("panel-content-source").boundingBox();
    await showHelp("音源ファイルの選択");
    assert(
      (await content.innerText()).includes("後から追加"),
      "Local source tooltip text missing"
    );
    const after = await page.getByTestId("panel-content-source").boundingBox();
    assert(
      JSON.stringify(before) === JSON.stringify(after),
      "Tooltip changed panel layout"
    );
    assert(!pickerOpened, "Help opened file picker");
    assert(
      (await page
        .getByTestId("panel-toggle-source")
        .getAttribute("aria-expanded")) === "true",
      "Help collapsed source panel"
    );
    await dismiss();
    if (!touch) {
      await help("音源ファイルの選択").focus();
      await content.waitFor({ state: "visible" });
      await dismiss();
      await help("音源ファイルの選択").press("Enter");
      await content.waitFor({ state: "visible" });
      await page.keyboard.press("Tab");
      await content.waitFor({ state: "hidden" });
    }
    await openPanel("remote-soundfont");
    await showHelp("Remote SoundFont / CORS");
    const tooltipBounds = await content.boundingBox();
    const viewport = page.viewportSize();
    assert(
      tooltipBounds.x >= 0 &&
        tooltipBounds.x + tooltipBounds.width <= viewport.width + 1,
      "Tooltip overflows viewport horizontally"
    );
    assert(
      tooltipBounds.y >= 0 &&
        tooltipBounds.y + tooltipBounds.height <= viewport.height + 1,
      "Tooltip overflows viewport vertically"
    );
    await page.screenshot({
      path: `${out}/${touch ? "touch" : "desktop"}-tooltip.png`,
    });
    if (touch) await page.getByTestId("source-title").tap();
    else await dismiss();
    await content.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "REMOTE URL", exact: true }).click();
    await openPanel("catalog");
    await showHelp("Remote catalog / JSON");
    assert(
      (await content.innerText()).includes("mdrUrl"),
      "Catalog schema help missing"
    );
    await dismiss();
    await page
      .getByRole("button", { name: "Load source", exact: true })
      .click();
    assert(
      (await page.getByTestId("playback-notice").innerText()).includes(
        "先にMDR／MDX URLを入力"
      ),
      "Required input notice hidden"
    );
    await page.getByRole("button", { name: "MML SCORE", exact: true }).click();
    await showHelp("MML editor / channel 01");
    assert(
      (await content.innerText()).includes("@MIDI"),
      "MML syntax help missing"
    );
    await dismiss();
    for (const id of [
      "playlist",
      "timing",
      "share",
      "diagnostics",
      "sysex",
      "midi-log",
      "export",
      "about",
    ])
      await openPanel(id);
    const helpers = await page.getByRole("button", { name: /の説明$/ }).all();
    for (const button of helpers) {
      await button.click();
      await content.waitFor({ state: "visible" });
      assert((await content.innerText()).trim().length > 0, "Empty tooltip");
      await dismiss();
    }
    assert(
      (await page
        .locator("button button, label button[data-slot='tooltip-trigger']")
        .count()) === 0,
      "Tooltip trigger nested in another control"
    );
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    assert(
      dimensions.documentWidth <= dimensions.width,
      "Expanded panels overflow horizontally"
    );
    await page.getByTestId("source-title").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${out}/${touch ? "touch" : "desktop"}-expanded.png`,
      fullPage: true,
    });
    report.checks.push({
      touch,
      helpers: helpers.length,
      tooltipBounds,
      defaultHidden: true,
      layoutStable: true,
      noticesVisible: true,
    });
    await page.close();
  }
  assert(!report.errors.length, report.errors.join("\n"));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
