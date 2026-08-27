import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const soundFontPath = process.env.SOUND_FONT_PATH ?? "/home/ubuntu/webdev-static-assets/GeneralUser-GS-v1.471.sf2";
const sourceUrl = "https://drive.google.com/file/d/shared-omega-id/view?usp=drive_link&resourcekey=0-omegaSharedKey";
const soundFont = await readFile(soundFontPath);
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const proxyRequests = [];
  await page.route("**/api/public-storage/soundfont?url=**", async (route) => {
    proxyRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/octet-stream", headers: { "x-remote-asset-final-url": "https://drive.usercontent.google.com/download?id=shared-omega-id&export=download&confirm=t&resourcekey=0-omegaSharedKey" }, body: soundFont });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByPlaceholder(/example\.org\/gs\.sf2/).fill(sourceUrl);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.getByText("共有ストレージのSoundFontをサーバー取得経路からブラウザ内へ読み込みました。", { exact: true }).waitFor({ state: "visible", timeout: 180_000 });
  const requestedUrl = new URL(proxyRequests[0] ?? "http://invalid");
  const relayedSourceUrl = requestedUrl.searchParams.get("url") ?? "";
  if (proxyRequests.length !== 1 || !relayedSourceUrl.includes("shared-omega-id") || !relayedSourceUrl.includes("resourcekey")) {
    throw new Error(`Expected one Google Drive SoundFont stream request with a resource key: ${proxyRequests.join(" | ")}`);
  }
  console.log(JSON.stringify({ sourceUrl, sizeMiB: Number((soundFont.byteLength / 1024 / 1024).toFixed(1)), proxyRequests: proxyRequests.length, remoteSoundFontLoaded: true }));
} finally {
  await browser.close();
}
