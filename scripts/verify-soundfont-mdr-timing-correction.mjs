import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const correction = page.getByLabel("SoundFont MDR遅延補正").getByLabel("SoundFont MDR発音補正 ms");
  await correction.fill("12");
  if (await correction.inputValue() !== "12") throw new Error("SoundFont timing correction did not accept the entered delay.");
  await page.reload({ waitUntil: "networkidle" });
  if (await page.getByLabel("SoundFont MDR遅延補正").getByLabel("SoundFont MDR発音補正 ms").inputValue() !== "12") throw new Error("SoundFont timing correction was not retained in browser storage.");
  console.log(JSON.stringify({ soundFontCorrectionVisible: true, persistedDelayMs: 12 }));
} finally {
  await browser.close();
}
