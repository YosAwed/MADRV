import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const format = process.env.FINITE_SOURCE_FORMAT ?? "mdx";
const sourcePath = process.env.FINITE_SOURCE_PATH ?? "/home/ubuntu/Downloads/DRA02.MDX";
const pdxPath = process.env.FINITE_PDX_PATH ?? "/home/ubuntu/Downloads/DRA00.PDX";
const soundFontPath = process.env.FINITE_SOUNDFONT_PATH;
const soundFontName = soundFontPath?.split(/[\\/]/).at(-1);
const expectedEndNotice = process.env.FINITE_END_NOTICE ?? (format === "mdx" ? "MDXのOPM／PDX再生が終了しました。" : "MDRのOPM／PDX再生が終了しました。");
const timeoutMs = Number(process.env.FINITE_END_TIMEOUT_MS ?? "180000");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  if (soundFontPath && soundFontName) {
    await page.locator('input[type="file"][accept*=".sf2"]').setInputFiles(soundFontPath);
    await page.getByRole("button", { name: soundFontName, exact: true }).waitFor({ state: "visible", timeout: 90_000 });
  }
  await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles([sourcePath, ...(pdxPath ? [pdxPath] : [])]);
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByText(expectedEndNotice, { exact: false }).waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByRole("button", { name: "再生" }).waitFor({ state: "visible", timeout: 5_000 });
  const playbackPosition = page.getByTestId("playback-position");
  const positionAtEnd = await playbackPosition.textContent();
  await page.waitForTimeout(500);
  const positionAfterWait = await playbackPosition.textContent();
  if (positionAtEnd !== "100.0%" || positionAfterWait !== positionAtEnd) {
    throw new Error(`${format} playback position did not stop at its endpoint: ${positionAtEnd} -> ${positionAfterWait}`);
  }
  const timerB = await page.getByLabel("Timer-B値").textContent();
  if (timerB !== "—") throw new Error(`${format} Timer-B did not reset after natural end: ${timerB}`);
  console.log(JSON.stringify({ format, sourcePath, soundFontPath: soundFontPath ?? null, naturalEnd: true, playbackPosition: positionAfterWait, timerB }));
} finally {
  await browser.close();
}
