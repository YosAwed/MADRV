import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const format = process.env.INFINITE_SOURCE_FORMAT ?? "mdx";
const sourcePath = process.env.INFINITE_SOURCE_PATH ?? "/home/ubuntu/Downloads/DRA02.MDX";
const pdxPath = process.env.INFINITE_PDX_PATH ?? "/home/ubuntu/Downloads/DRA00.PDX";
const observeMs = Number(process.env.INFINITE_OBSERVE_MS ?? "22000");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  const input = page.locator('input[type="file"][accept*=".mdx"]');
  await input.setInputFiles([sourcePath, ...(pdxPath ? [pdxPath] : [])]);
  await page.getByRole("button", { name: "無限ループを切り替える" }).click();
  if (await page.getByRole("button", { name: "無限ループを切り替える" }).getAttribute("aria-pressed") !== "true") throw new Error("Infinite loop control did not become active");
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByText(/無限ループ再生中です。停止ボタンで終了します。/).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(observeMs);
  if (!await page.getByLabel("停止").isVisible().catch(() => false)) throw new Error(`${format} infinite playback ended during ${observeMs} ms observation`);
  const position = await page.getByTestId("playback-position").textContent();
  await page.getByLabel("停止").click();
  await page.getByRole("button", { name: "再生" }).waitFor({ state: "visible", timeout: 8_000 });
  if ((await page.getByLabel("Timer-B値").textContent()) !== "—") throw new Error("Timer-B did not reset after manually stopping infinite playback");
  console.log(JSON.stringify({ format, sourcePath, observeMs, position, stopped: true }));
} finally {
  await browser.close();
}
