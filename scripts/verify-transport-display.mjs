import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

function readPercent(value) {
  const match = value.match(/translate3d\(([-\d.]+)%/);
  if (!match) throw new Error(`Unexpected marker transform: ${value}`);
  return Number(match[1]);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByText("Playback position", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Configured output level", { exact: true }).nth(0).waitFor({ state: "visible" });
  if (await page.getByText("Configured output level", { exact: true }).count() !== 3) throw new Error("Expected one configured output level label for every engine");

  const marker = page.getByTestId("playback-marker");
  await page.getByRole("button", { name: "再生" }).click();
  await page.waitForTimeout(350);
  const firstPosition = readPercent(await marker.getAttribute("style") ?? "");
  await page.waitForTimeout(450);
  const secondPosition = readPercent(await marker.getAttribute("style") ?? "");
  if (firstPosition <= 0 || secondPosition <= firstPosition) throw new Error(`Marker did not progress smoothly: ${firstPosition} -> ${secondPosition}`);
  await page.screenshot({ path: "/home/ubuntu/madrv-player-web/test-artifacts/transport-display-playing.png", fullPage: true });
  await page.getByRole("button", { name: "停止" }).first().click();
  console.log("transport display and output-level labels: passed");
} finally {
  await browser.close();
}
