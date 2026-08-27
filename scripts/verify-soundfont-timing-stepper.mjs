import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const input = page.getByLabel("SoundFont MDR発音補正 ms");
  const increase = page.getByTestId("soundfont-timing-step-up");
  const decrease = page.getByTestId("soundfont-timing-step-down");
  await increase.click();
  await increase.click();
  if (await input.inputValue() !== "2") throw new Error(`Expected +2 ms after mouse increments, received ${await input.inputValue()}`);
  await decrease.click();
  await decrease.click();
  await decrease.click();
  if (await input.inputValue() !== "-1") throw new Error(`Expected -1 ms after mouse decrements, received ${await input.inputValue()}`);
  await input.fill("-17");
  await input.blur();
  await increase.click();
  if (await input.inputValue() !== "-16") throw new Error(`Expected direct negative input then increment to -16 ms, received ${await input.inputValue()}`);
  await page.getByRole("button", { name: /B · 補正なし/i }).click();
  const preview = page.getByTestId("soundfont-ab-preview");
  if (await preview.getAttribute("data-active-delay-ms") !== "0") throw new Error("A/B無補正比較中の有効補正が0 msではありません");
  await page.reload({ waitUntil: "domcontentloaded" });
  if (await page.getByLabel("SoundFont MDR発音補正 ms").inputValue() !== "-16") throw new Error("補正値の保存・復元に失敗しました");
  console.log(JSON.stringify({ mouseIncrement: 2, mouseDecrement: -1, directNegativeThenIncrement: -16, abBypass: true, persisted: true }));
} finally {
  await browser.close();
}
