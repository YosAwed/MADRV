import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const soundFontBytes = await readFile(process.env.SOUND_FONT_PATH ?? "/home/ubuntu/webdev-static-assets/GeneralUser-GS-v1.471.sf2");
const bankA = "https://example.org/Signal-A.sf2";
const bankB = "https://example.org/Signal-B.sf2";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("https://example.org/*.sf2", async (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: soundFontBytes }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const remoteInput = page.locator('input[placeholder*="example.org/gs.sf2"]');
  const load = page.getByRole("button", { name: "Load", exact: true });
  const correction = page.getByLabel("SoundFont MDR遅延補正").getByLabel("SoundFont MDR発音補正 ms");

  await remoteInput.fill(bankA);
  await load.click();
  await page.getByText("Remote · Signal-A.sf2", { exact: true }).waitFor({ timeout: 15_000 });
  await correction.fill("28");
  if (await correction.inputValue() !== "28") throw new Error("Bank A timing profile did not accept its correction.");
  const preview = page.getByTestId("soundfont-ab-preview");
  const comparison = page.getByLabel("SoundFont補正A/B試聴");
  if (await preview.getAttribute("data-active-delay-ms") !== "28") throw new Error("A preview did not apply Bank A's saved correction.");
  await comparison.getByRole("button", { name: /B · 補正なし/ }).click();
  if (await correction.inputValue() !== "28" || await preview.getAttribute("data-active-delay-ms") !== "0") throw new Error("B preview did not bypass timing without preserving the saved correction.");
  await comparison.getByRole("button", { name: /A · 補正あり/ }).click();
  if (await preview.getAttribute("data-active-delay-ms") !== "28") throw new Error("A preview did not restore the saved timing correction.");

  await remoteInput.fill(bankB);
  await load.click();
  await page.getByText("Remote · Signal-B.sf2", { exact: true }).waitFor({ timeout: 15_000 });
  await correction.fill("-17");
  if (await correction.inputValue() !== "-17") throw new Error("Bank B timing profile did not accept its correction.");

  await remoteInput.fill(bankA);
  await load.click();
  await page.getByText("Remote · Signal-A.sf2", { exact: true }).waitFor({ timeout: 15_000 });
  if (await correction.inputValue() !== "28") throw new Error(`Bank A correction was not restored: ${await correction.inputValue()}`);
  await page.reload({ waitUntil: "networkidle" });
  await remoteInput.fill(bankB);
  await load.click();
  await page.getByText("Remote · Signal-B.sf2", { exact: true }).waitFor({ timeout: 15_000 });
  if (await correction.inputValue() !== "-17") throw new Error(`Bank B correction was not persisted after reload: ${await correction.inputValue()}`);
  console.log(JSON.stringify({ bankA: 28, bankB: -17, abPreview: true, profileSwitching: true, browserPersistence: true }));
} finally {
  await browser.close();
}
