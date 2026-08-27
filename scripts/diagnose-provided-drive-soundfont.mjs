import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const sharedUrl = "https://drive.google.com/file/d/1zgIyr_uP2_D_LSa0VhTl-FAInAV2bzaK/view?usp=share_link";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const requests = [];
  const errors = [];
  page.on("request", request => {
    if (request.url().includes("/api/public-storage/soundfont")) requests.push(request.url());
  });
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('input[placeholder*="example.org/gs.sf2"]').fill(sharedUrl);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(node => node.textContent?.includes("Remote ·")) || document.body.textContent?.includes("Remote SoundFont load failed"), undefined, { timeout: 240_000 });
  const snapshot = await page.evaluate(() => ({
    title: Array.from(document.querySelectorAll("button")).map(node => node.textContent ?? "").find(text => text.includes("Remote ·") || text.includes("Remote SoundFont load failed")) ?? "",
    notice: Array.from(document.querySelectorAll("p")).map(node => node.textContent ?? "").find(text => text.includes("共有ストレージのSoundFont") || text.includes("読み込めませんでした") || text.includes("取得に失敗")) ?? "",
  }));
  console.log(JSON.stringify({ requests, errors, ...snapshot }));
} finally {
  await browser.close();
}
