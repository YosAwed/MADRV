import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const diagnostics = page.getByTestId("playback-diagnostics");
  await diagnostics.getByLabel("推定BPM").getByText("132.0 BPM").waitFor({ state: "visible" });

  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles([
    "/home/ubuntu/Downloads/DRA02.MDX",
    "/home/ubuntu/Downloads/DRA00.PDX",
  ]);
  await page.getByRole("button", { name: "再生" }).click();
  await diagnostics.getByLabel("Timer-B値").filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 15_000 });
  await diagnostics.getByLabel("推定BPM").filter({ hasText: /\d+\.\d BPM/ }).waitFor({ state: "visible", timeout: 15_000 });
  await diagnostics.getByLabel("再生クロック").filter({ hasText: /\d+\.\d kHz/ }).waitFor({ state: "visible" });
  await page.screenshot({ path: "/home/ubuntu/madrv-player-web/test-artifacts/tempo-diagnostics.png", fullPage: true });
  await page.getByLabel("停止").click();
  await diagnostics.getByLabel("Timer-B値").getByText("—").waitFor({ state: "visible", timeout: 5_000 });
  console.log("tempo and clock diagnostics: passed");
} finally {
  await browser.close();
}
