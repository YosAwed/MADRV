import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const correction = page.getByLabel("SoundFont MDR発音補正 ms");
  await correction.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("-");
  if (await correction.inputValue() !== "-") throw new Error("The intermediate minus sign was not retained.");
  await page.keyboard.type("17");
  if (await correction.inputValue() !== "-17") throw new Error(`Negative correction could not be typed: ${await correction.inputValue()}`);
  await correction.evaluate((element) => element.setSelectionRange(element.value.length, element.value.length));
  await page.keyboard.press("ArrowLeft");
  const firstLeft = await correction.evaluate((element) => element.selectionStart);
  await page.keyboard.press("ArrowLeft");
  const secondLeft = await correction.evaluate((element) => element.selectionStart);
  if (firstLeft !== 2 || secondLeft !== 1) throw new Error(`ArrowLeft did not move the caret through a negative value: ${JSON.stringify({ firstLeft, secondLeft })}`);
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => window.localStorage.getItem("madrv-player.soundfont-mdr-delay-ms") === "-17", undefined, { timeout: 5_000 });
  await page.getByRole("button", { name: "A · 補正あり -17 ms", exact: true }).waitFor({ state: "visible", timeout: 5_000 });
  console.log(JSON.stringify({ negativeInput: -17, caretPositions: [firstLeft, secondLeft], persisted: true, abLabelUpdated: true }));
} finally {
  await browser.close();
}
