import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const tabs = await page.locator('button').evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim()).filter((text) => ["LOCAL FILE", "REMOTE URL", "MML SCORE"].includes(text ?? "")));
  if (tabs.join("|") !== "LOCAL FILE|REMOTE URL|MML SCORE") throw new Error(`Unexpected source-tab order: ${JSON.stringify(tabs)}`);
  await page.getByText("MDR / MDX / PDXを置く", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "MML SCORE" }).click();
  await page.getByLabel("MMLを入力").waitFor({ state: "visible" });
  await page.getByTestId("remote-soundfont-progress").getByText("SoundFont ready").waitFor({ state: "visible", timeout: 180_000 });
  const remoteUrl = await page.locator('input[placeholder*="example.org/gs.sf2"]').inputValue();
  if (!remoteUrl.includes("GeneralUser%20GS%20v1.471.sf2")) throw new Error(`Default SoundFont URL was not applied: ${remoteUrl}`);
  console.log(JSON.stringify({ tabs, defaultMode: "local", mmlTabWorks: true, defaultSoundFontAutoLoaded: true }));
} finally {
  await browser.close();
}
