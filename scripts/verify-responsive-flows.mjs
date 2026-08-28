import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const demoMdr = "/manus-storage/signal-deck-diagnostic_d91a1673.mdr";
const scenarios = [
  { name: "mobile", viewport: { width: 375, height: 812 } },
  { name: "desktop", viewport: { width: 1280, height: 720 } },
];

async function requireVisible(locator, description) {
  await locator.waitFor({ state: "visible", timeout: 45_000 });
  if (!(await locator.isVisible())) throw new Error(`${description} is not visible`);
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: scenario.viewport });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "再生" }).click();
    await requireVisible(page.getByText("9ノートをOPM経路へ送出しています。"), `${scenario.name} MML playback`);
    await page.getByLabel("停止").click();

    const sessionUrl = `${baseUrl}/?sd=1&loops=2&maxSec=45&mdr=${encodeURIComponent(demoMdr)}`;
    await page.goto(sessionUrl, { waitUntil: "networkidle" });
    await requireVisible(page.getByText("リモートMDRを読込みました。共有セッション / 1 active tracks。データはブラウザのメモリ内だけで完全再生します。"), `${scenario.name} shared session restore`);
    const loopInput = page.locator('label:has-text("Loop cap / repeats") input');
    if ((await loopInput.inputValue()) !== "2") throw new Error(`${scenario.name} loop value was not restored`);

    const mdrInput = page.locator('input[placeholder*="song.mdr"]');
    await mdrInput.fill("https://example.invalid/missing.mdr");
    await page.getByRole("button", { name: "Load source" }).click();
    await requireVisible(page.getByText("MDR URLを取得できませんでした。CORS対応URLか、Google Drive／Dropboxの公開共有リンクを指定してください。"), `${scenario.name} remote error guidance`);

    await page.getByRole("button", { name: "MML SCORE" }).click();
    await page.getByRole("button", { name: /LOAD TEST PRESET/i }).click();
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await requireVisible(page.getByText("CORS対応SoundFontをブラウザ内へ直接読み込みました。次回訪問時もこのブラウザから自動復元します。"), `${scenario.name} remote SoundFont`);
    await page.screenshot({ path: `/home/ubuntu/madrv-player-web/test-artifacts/${scenario.name}-responsive-flow.png`, fullPage: true });
    await page.close();
    console.log(`${scenario.name}: passed`);
  }
} finally {
  await browser.close();
}
