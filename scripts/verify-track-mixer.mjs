import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mdrPath = "/home/ubuntu/webdev-static-assets/track-keyboard-opm-midi-test.mdr";
const pdxPath = "/home/ubuntu/Downloads/DRA00.PDX";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  const fileInput = page.locator('input[type="file"][accept*=".mdr"]');
  await fileInput.setInputFiles(mdrPath);
  await page.getByText("Track matrix / MDR & MDX mixer").waitFor({ state: "visible", timeout: 20_000 });
  const liveKeys = page.getByTestId("track-key-overview");
  await liveKeys.getByRole("img", { name: /OPM 1は発音待機中です。/ }).waitFor({ state: "visible" });

  await fileInput.setInputFiles(pdxPath);
  await page.getByText(/PDX「DRA00\.PDX」を追加しました。MDRと組み合わせて完全再生します。/).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByText("MDR / OPM + PDXをWebAssemblyで再生中です。ループ上限: 1回。").waitFor({ state: "visible", timeout: 30_000 });
  await liveKeys.getByRole("img", { name: /OPM 1で.+が発音中です。/ }).waitFor({ state: "visible", timeout: 8_000 });
  await liveKeys.getByRole("img", { name: "GS 1でCが発音中です。" }).waitFor({ state: "visible", timeout: 8_000 });
  await page.screenshot({ path: "/home/ubuntu/madrv-player-web/test-artifacts/track-mixer-key-on.png", fullPage: true });

  const muteOn = page.getByRole("button", { name: "OPM 1のミュートをオンにする" });
  if (await muteOn.getAttribute("aria-pressed") !== "false") throw new Error("track should begin unmuted");
  await muteOn.click();
  const muteOff = page.getByRole("button", { name: "OPM 1のミュートをオフにする" });
  if (await muteOff.getAttribute("aria-pressed") !== "true") throw new Error("track mute did not turn on");
  await liveKeys.getByRole("img", { name: "OPM 1はミュート中です。" }).waitFor({ state: "visible" });
  await muteOff.click();
  if (await page.getByRole("button", { name: "OPM 1のミュートをオンにする" }).getAttribute("aria-pressed") !== "false") throw new Error("track mute did not turn off");
  const midiMuteOn = page.getByRole("button", { name: "GS 1のミュートをオンにする" });
  await midiMuteOn.click();
  await liveKeys.getByRole("img", { name: "GS 1はミュート中です。" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "GS 1のミュートをオフにする" }).click();
  await page.getByRole("button", { name: "停止" }).first().click();
  await liveKeys.getByRole("img", { name: /OPM 1は発音待機中です。/ }).waitFor({ state: "visible" });
  await liveKeys.getByRole("img", { name: /GS 1は発音待機中です。/ }).waitFor({ state: "visible" });
  await page.screenshot({ path: "/home/ubuntu/madrv-player-web/test-artifacts/track-mixer.png", fullPage: true });
  console.log("track keyboard and mute toggle: passed");
} finally {
  await browser.close();
}
