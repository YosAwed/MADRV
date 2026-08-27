import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const waitMs = Number(process.env.MDR_START_WAIT_MS ?? "3000");
const mdrPath = process.env.MDR_PLAYBACK_SOURCE ?? "/home/ubuntu/upload/MEGALITH.MDR";
const pdxPath = process.env.PDX_PLAYBACK_SOURCE;
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const requestFailures = [];
  const assetResponses = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => requestFailures.push({ url: request.url(), failure: request.failure()?.errorText ?? "unknown" }));
  page.on("response", (response) => { if (response.url().includes("madrv-") || response.url().includes("spessasynth")) assetResponses.push({ asset: new URL(response.url()).pathname.split("/").at(-1), status: response.status() }); });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles([mdrPath, ...(pdxPath ? [pdxPath] : [])]);
  await page.getByLabel("MDR metadata").waitFor({ state: "visible" });
  const metadata = await page.getByLabel("MDR metadata").textContent();
  const trackOverview = await page.getByTestId("track-key-overview").textContent();
  await page.getByRole("button", { name: "再生" }).click();
  await page.waitForTimeout(waitMs);
  const state = await page.evaluate(() => ({
    notice: Array.from(document.querySelectorAll("p")).map((node) => node.textContent ?? "").find((text) => text.includes("再生") || text.includes("失敗") || text.includes("WebAssembly")) ?? "",
    stopVisible: Boolean(document.querySelector('button[aria-label="停止"]')),
    peak: document.querySelector('[data-testid="output-peak"]')?.textContent ?? "",
    playhead: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "",
    timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent ?? "",
      bpm: document.querySelector('[aria-label="推定BPM"]')?.textContent ?? "",
      playButton: document.querySelector('button[aria-label="再生"]') ? "visible" : "absent",
    }));
  console.log(JSON.stringify({ mdrPath, pdxPath, waitMs, metadata, trackOverview, state, consoleErrors, requestFailures, assetResponses }));
} finally {
  await browser.close();
}
