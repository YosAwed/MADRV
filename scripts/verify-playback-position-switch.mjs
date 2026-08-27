import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator("input[webkitdirectory]").setInputFiles("/tmp/madrv-playlist-test");
  const playlist = page.getByLabel("プレイリスト");
  await playlist.waitFor({ state: "visible", timeout: 15_000 });
  const playlistButtons = playlist.locator("button");
  if (await playlistButtons.count() < 3) throw new Error("Expected a play control and two playlist entries.");

  await playlist.getByRole("button", { name: "Play selected" }).click();
  await page.waitForFunction(() => Number.parseFloat(document.querySelector('[data-testid="playback-position"]')?.textContent ?? "0") >= 8, undefined, { timeout: 25_000 });
  const firstProgress = Number.parseFloat(await page.getByTestId("playback-position").textContent() ?? "0");

  await playlistButtons.nth(2).click();
  await page.waitForFunction(() => Number.parseFloat(document.querySelector('[data-testid="playback-position"]')?.textContent ?? "100") < 1.5, undefined, { timeout: 5_000 });
  const samples = [];
  for (let index = 0; index < 12; index += 1) {
    await page.waitForTimeout(180);
    samples.push(Number.parseFloat(await page.getByTestId("playback-position").textContent() ?? "NaN"));
  }
  const highestAfterSwitch = Math.max(...samples);
  if (!samples.every(Number.isFinite) || highestAfterSwitch >= 8 || highestAfterSwitch <= 0.2) {
    throw new Error(`Playback position did not reset and advance on the newly selected source: first=${firstProgress}, after=${JSON.stringify(samples)}`);
  }
  await page.getByLabel("停止").click();
  console.log(JSON.stringify({ firstProgress, highestAfterSwitch, samples, resetOnSourceSwitch: true }));
} finally {
  await browser.close();
}
