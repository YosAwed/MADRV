import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const playlistTimeoutMs = Number(process.env.PLAYLIST_TIMEOUT_MS ?? "45000");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  const folderInput = page.locator('input[webkitdirectory]');
  await folderInput.setInputFiles("/tmp/madrv-playlist-test");
  await page.getByLabel("プレイリスト").waitFor({ state: "visible", timeout: 15_000 });
  const items = page.getByLabel("プレイリスト").locator('button').filter({ hasText: /Signal Deck|Track keyboard|MDR/ });
  if (await items.count() < 2) throw new Error(`Expected two local playlist entries, found ${await items.count()}`);
  const expectedFirstTitle = (await page.getByTestId("playlist-entry-title-0").textContent())?.trim();
  const firstPathLabel = (await page.getByTestId("playlist-entry-path-0").textContent())?.trim();
  const expectedFirstSource = firstPathLabel?.split(" · ").at(-1)?.toUpperCase();
  if (!expectedFirstTitle) throw new Error("The first local playlist entry did not expose a title.");
  if (!expectedFirstSource) throw new Error("The first local playlist entry did not expose a source path.");
  await page.getByTestId("playlist-entry-0").click();
  await page.getByLabel("停止").waitFor({ state: "visible", timeout: 15_000 });
  const loadedFirstTitle = (await page.getByTestId("source-title").textContent())?.trim();
  if (loadedFirstTitle !== expectedFirstSource) throw new Error(`First playlist click loaded a different source: expected ${JSON.stringify(expectedFirstSource)}, got ${JSON.stringify(loadedFirstTitle)}`);
  await page.waitForFunction((title) => document.body.textContent?.includes(`プレイリスト 1 / 2「${title}」`), expectedFirstTitle, { timeout: 15_000 });
  await page.getByLabel("停止").click();
  await page.getByRole("button", { name: "再生" }).waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: "Play selected" }).click();
  try {
    await page.waitForFunction(() => document.body.textContent?.includes("プレイリスト最終曲"), undefined, { timeout: playlistTimeoutMs });
  } catch {
    const diagnostics = await page.evaluate(() => ({ notices: Array.from(document.querySelectorAll("p")).map((node) => node.textContent).filter((value) => value?.includes("プレイリスト") || value?.includes("再生できません") || value?.includes("PDX")), playhead: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent, bpm: document.querySelector('[aria-label="推定BPM"]')?.textContent, playing: document.querySelector('[aria-label="停止"]') !== null }));
    throw new Error(`Playlist did not reach its final entry within ${playlistTimeoutMs}ms: ${JSON.stringify(diagnostics)}`);
  }
  const notice = await page.locator("p").filter({ hasText: "プレイリスト最終曲" }).textContent();
  if (!notice?.includes("再生を停止しました")) throw new Error(`Playlist did not stop at final entry: ${notice}`);
  if (await page.getByLabel("停止").isVisible()) throw new Error("Stop control remained active after the final playlist entry.");
  console.log(JSON.stringify({ entryCount: await items.count(), firstClickedTitle: expectedFirstTitle, firstClickedSource: expectedFirstSource, firstClickLoadedSameEntry: true, notice, stoppedAtLastEntry: true }));
} finally {
  await browser.close();
}
