import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles([
    "/home/ubuntu/Downloads/DRA02.MDX",
    "/home/ubuntu/Downloads/DRA00.PDX",
  ]);
  await page.getByTestId("track-key-overview").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("Live track keys / always visible").waitFor({ state: "visible" });
  await page.getByRole("img", { name: "OPM 1は発音待機中です。" }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByRole("img", { name: /OPM 1で.+が発音中です。/ }).first().waitFor({ state: "visible", timeout: 10_000 });
  await page.screenshot({ path: "/home/ubuntu/madrv-player-web/test-artifacts/mdx-track-overview.png", fullPage: true });
  console.log("MDX live track keys: passed");
} finally {
  await browser.close();
}
