import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  const input = page.locator('input[type="file"][accept*=".mdr"]');
  await input.setInputFiles("/home/ubuntu/webdev-static-assets/track-keyboard-opm-midi-test.mdr");
  await input.setInputFiles("/home/ubuntu/Downloads/DRA00.PDX");
  await page.getByRole("button", { name: "再生" }).click();
  const observations = [];
  for (const delay of [25, 100, 250, 500, 800]) {
    await page.waitForTimeout(delay);
    observations.push(await page.evaluate((delayMs) => ({
      delay: delayMs,
      stopVisible: Boolean(document.querySelector('button[aria-label="停止"]')),
      notice: Array.from(document.querySelectorAll("p")).map((node) => node.textContent ?? "").find((text) => text.includes("WebAssembly") || text.includes("終了")) ?? "",
      keys: Array.from(document.querySelectorAll('[data-testid="track-key-overview"] [role="img"]')).map((node) => node.getAttribute("aria-label")),
    }), delay));
  }
  console.log(JSON.stringify(observations, null, 2));
} finally {
  await browser.close();
}
