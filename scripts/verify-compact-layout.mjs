import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const out = process.env.COMPACT_REPORT_DIR ?? "/tmp/madrv-compact-ui";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const report = { baseUrl, viewports: [], checks: [] };
try {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", route =>
    route.abort()
  );
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(() => {
    window.__compactAudio = { callbacks: 0, peak: 0 };
    const create = AudioContext.prototype.createScriptProcessor;
    AudioContext.prototype.createScriptProcessor = function (...args) {
      const node = create.apply(this, args);
      Object.defineProperty(node, "onaudioprocess", {
        set(callback) {
          node.addEventListener("audioprocess", event => {
            callback(event);
            window.__compactAudio.callbacks++;
            for (
              let channel = 0;
              channel < event.outputBuffer.numberOfChannels;
              channel++
            ) {
              for (const value of event.outputBuffer.getChannelData(channel))
                window.__compactAudio.peak = Math.max(
                  window.__compactAudio.peak,
                  Math.abs(value)
                );
            }
          });
        },
      });
      return node;
    };
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const toggle = id => page.getByTestId(`panel-toggle-${id}`);
  const open = async id => {
    if ((await toggle(id).getAttribute("aria-expanded")) !== "true")
      await toggle(id).click();
  };
  const close = async id => {
    if ((await toggle(id).getAttribute("aria-expanded")) === "true")
      await toggle(id).click();
  };

  await page.getByRole("button", { name: "MML SCORE", exact: true }).click();
  const mml = "T140 O4 L8 c d e f g a b > c";
  await page.getByLabel("MMLを入力").fill(mml);
  await close("source");
  if (await page.getByLabel("MMLを入力").count())
    throw new Error("Closed panel still mounts editor.");
  await toggle("source").focus();
  await page.keyboard.press("Enter");
  if ((await page.getByLabel("MMLを入力").inputValue()) !== mml)
    throw new Error("Folding lost editor state.");
  report.checks.push(
    "MML retained across unmount; keyboard Enter toggles panel"
  );
  await open("diagnostics");
  await close("levels");
  await page.reload({ waitUntil: "networkidle" });
  if (
    (await toggle("diagnostics").getAttribute("aria-expanded")) !== "true" ||
    (await toggle("levels").getAttribute("aria-expanded")) !== "false"
  )
    throw new Error("Panel state was not restored.");
  await close("diagnostics");
  await open("levels");
  report.checks.push("Open and closed states restored on reload");

  await close("soundfont");
  await page.getByRole("button", { name: "MML SCORE", exact: true }).click();
  await page.getByLabel("MMLを入力").fill("@MIDI T120 O4 C4");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.getByTestId("soundfont-bank-button").waitFor();
  if ((await toggle("soundfont").getAttribute("aria-expanded")) !== "true")
    throw new Error("Missing SoundFont did not reveal the bank panel.");
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "soundfont-bank-button"
  );
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  report.checks.push(
    "Missing MIDI bank reveals and focuses a persisted closed SoundFont panel"
  );

  if (!process.env.MDR_SOURCE || !process.env.MDR_SF_PATH)
    throw new Error("Set MDR_SOURCE, MDR_SF_PATH and optional MDR_PDX_PATH.");
  await page
    .locator('input[type="file"][accept*=".sf2"]')
    .setInputFiles(process.env.MDR_SF_PATH);
  await page
    .getByTestId("playback-notice")
    .filter({ hasText: "SoundFontを読み込みました" })
    .waitFor({ timeout: 60000 });
  await page
    .locator('input[type="file"][accept*=".mdr"]')
    .setInputFiles([
      process.env.MDR_SOURCE,
      ...(process.env.MDR_PDX_PATH ? [process.env.MDR_PDX_PATH] : []),
    ]);
  await page
    .getByTestId("playback-notice")
    .filter({ hasText: "トラックを検出" })
    .waitFor();
  for (const [width, height] of [
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [960, 740],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    const measured = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      transportBottom: document
        .querySelector(".compact-transport")
        .getBoundingClientRect().bottom,
      mainBottom: document
        .querySelector(".compact-main")
        .getBoundingClientRect().bottom,
    }));
    if (measured.scrollWidth > width + 1)
      throw new Error(`Horizontal overflow at ${width}`);
    if (width >= 1366 && measured.scrollHeight > height + 1)
      throw new Error(
        `Default desktop requires scrolling: ${JSON.stringify(measured)}`
      );
    await page.screenshot({
      path: `${out}/${width}-loaded.png`,
      fullPage: true,
    });
    report.viewports.push(measured);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByLabel("無限ループを切り替える").click();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() => window.__compactAudio.peak > 0, null, {
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  if (await page.getByTestId("track-full-keyboard").count())
    throw new Error("Collapsed matrix still renders keyboards.");
  await open("matrix");
  if (!(await page.getByTestId("track-full-keyboard").count()))
    throw new Error("Expanded matrix has no keyboards.");
  await page.getByRole("button", { name: "OPM / MIDI", exact: true }).click();
  await page.getByTestId("keyboard-matrix-engines").waitFor();
  await close("matrix");
  if (await page.getByTestId("track-full-keyboard").count())
    throw new Error("Matrix did not unmount.");
  await open("activity");
  await page.getByTestId("channel-note-state").waitFor();
  await close("activity");
  await close("source");
  await close("soundfont");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "停止", exact: true }).first().click();
  report.audio = await page.evaluate(() => window.__compactAudio);
  report.checks.push(
    "30-track hardware + built-in MIDI playback; folding source/SoundFont/matrix during playback; stop"
  );
  await open("source");
  await open("soundfont");
  // Every section remains reachable, including nested URL and GS controls.
  const opened = [];
  for (let i = 0; i < 30; i++) {
    const next = page
      .locator('button[data-testid^="panel-toggle-"][aria-expanded="false"]')
      .first();
    if (!(await next.count())) break;
    opened.push(await next.getAttribute("data-testid"));
    await next.click();
  }
  for (const id of [
    "playback-advisor",
    "soundfont-timing-profile",
    "saved-playlist",
  ])
    await page.getByTestId(id).waitFor();
  await page.getByRole("button", { name: "Add current", exact: true }).click();
  await page.getByTestId("playlist-entry-title-0").waitFor();
  await page.getByRole("button", { name: "REMOTE URL", exact: true }).click();
  await open("catalog");
  await page
    .getByRole("button", { name: "Load catalog", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Load source", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "MML SCORE", exact: true }).click();
  await page.getByLabel("MMLを入力").waitFor();
  await page.getByTestId("format-guide-button").click();
  await page.getByTestId("format-guide-body").waitFor();
  await page.keyboard.press("Escape");
  report.checks.push(
    `Expanded ${opened.length} panels; playlist add, remote inputs/catalog, MML and format guide accessible`
  );
  report.errors = errors;
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
