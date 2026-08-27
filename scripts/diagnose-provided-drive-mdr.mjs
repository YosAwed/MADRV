import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "https://madrvplay-elrop8px.manus.space";
const sourceUrl = "https://drive.google.com/file/d/1vNZaDBGuiwvzHPqmLyhNj00ewCm6ZdDK/view?usp=share_link";
const pdxUrl = process.env.PROVIDED_MDR_PDX_URL ?? "";
const soundFontUrl = process.env.PROVIDED_MDR_SOUNDFONT_URL ?? "";
const waitMs = Number(process.env.PROVIDED_MDR_WAIT_MS ?? "15000");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const trpcResponses = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", response => { if (response.url().includes("/api/trpc/")) trpcResponses.push({ status: response.status(), url: response.url() }); });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (soundFontUrl) {
    await page.getByPlaceholder(/example\.org\/gs\.sf2/).fill(soundFontUrl);
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await page.getByTestId("remote-soundfont-progress").getByText("SoundFont ready").waitFor({ state: "visible", timeout: 120_000 });
  }
  await page.getByRole("button", { name: "REMOTE URL" }).click();
  await page.getByPlaceholder(/song\.mdr/).fill(sourceUrl);
  if (pdxUrl) await page.getByPlaceholder(/song\.pdx/).fill(pdxUrl);
  await page.getByRole("button", { name: "Load source" }).click();
  await page.waitForTimeout(4_000);
  const afterLoad = await page.evaluate(() => ({
    notice: document.querySelector('[data-testid="playback-notice"]')?.textContent?.trim() ?? "",
    metadata: document.querySelector('[aria-label="MDR metadata"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    playAvailable: Boolean(document.querySelector('button[aria-label="再生"]')),
  }));
  if (afterLoad.playAvailable && afterLoad.metadata) await page.getByRole("button", { name: "再生" }).click();
  await page.waitForTimeout(waitMs);
  const afterPlay = await page.evaluate(() => ({
    notice: document.querySelector('[data-testid="playback-notice"]')?.textContent?.trim() ?? "",
    stopVisible: Boolean(document.querySelector('button[aria-label="停止"]')),
    position: document.querySelector('[data-testid="playback-position"]')?.textContent?.trim() ?? "",
    timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent?.trim() ?? "",
    bpm: document.querySelector('[aria-label="推定BPM"]')?.textContent?.trim() ?? "",
  }));
  await page.screenshot({ path: "/home/ubuntu/Downloads/provided-drive-mdr-diagnosis.png", fullPage: true });
  console.log(JSON.stringify({ sourceUrl, pdxUrl: pdxUrl || undefined, soundFontUrl: soundFontUrl || undefined, afterLoad, afterPlay, consoleErrors, trpcResponses }));
} finally {
  await browser.close();
}
