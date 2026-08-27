import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const soundFontUrl = "https://raw.githubusercontent.com/JustEnoughLinuxOS/generaluser-gs/main/GeneralUser%20GS%20v1.471.sf2";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.__soundFontProgressSamples = [];
    const capture = () => {
      const panel = document.querySelector('[data-testid="remote-soundfont-progress"]');
      const percent = document.querySelector('[data-testid="remote-soundfont-progress-percent"]')?.textContent?.trim();
      const bytes = document.querySelector('[data-testid="remote-soundfont-progress-bytes"]')?.textContent?.trim();
      if (!panel || !percent || !bytes) return;
      const previous = window.__soundFontProgressSamples.at(-1);
      if (!previous || previous.percent !== percent || previous.bytes !== bytes) window.__soundFontProgressSamples.push({ percent, bytes });
    };
    new MutationObserver(capture).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.locator('input[placeholder*="example.org/gs.sf2"]').fill(soundFontUrl);
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="remote-soundfont-progress"]')?.textContent?.includes("SoundFont ready") || document.body.textContent?.includes("Remote SoundFont load failed"), undefined, { timeout: 120_000 });
  const result = await page.evaluate(() => ({
    samples: window.__soundFontProgressSamples,
    progress: document.querySelector('[data-testid="remote-soundfont-progress"]')?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    percent: document.querySelector('[data-testid="remote-soundfont-progress-percent"]')?.textContent?.trim() ?? "",
    bytes: document.querySelector('[data-testid="remote-soundfont-progress-bytes"]')?.textContent?.trim() ?? "",
  }));
  await page.locator('[data-testid="remote-soundfont-progress"]').screenshot({ path: "/home/ubuntu/Downloads/soundfont-progress-ready.png" });
  if (result.percent !== "100%" || !result.bytes.includes("/") || !result.progress.includes("SoundFont ready")) throw new Error(`SoundFont progress did not finish correctly: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ errors, ...result }));
} finally {
  await browser.close();
}
