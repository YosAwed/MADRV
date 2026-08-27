import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "無限ループを切り替える" }).click();
  if (await page.getByRole("button", { name: "無限ループを切り替える" }).getAttribute("aria-pressed") !== "true") throw new Error("Infinite loop toggle did not activate");
  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  await page.getByRole("button", { name: /Export MP4/i }).click();
  await page.getByText(/∞通常再生は書き出し時に1回・最大60秒へ安全に有限化します。/).waitFor({ state: "visible", timeout: 10_000 });
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  if (!/madrv-signal-deck-.+\.(mp4|webm)$/i.test(suggestedFilename)) throw new Error(`Unexpected export filename: ${suggestedFilename}`);
  console.log(JSON.stringify({ suggestedFilename, infiniteModeFiniteExport: true }));
} finally {
  await browser.close();
}
