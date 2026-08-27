import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const playlistTimeoutMs = Number(process.env.PLAYLIST_TIMEOUT_MS ?? "45000");
const mdrBytes = await readFile("/home/ubuntu/webdev-static-assets/track-keyboard-opm-midi-test.mdr");
const pdxBytes = await readFile("/home/ubuntu/Downloads/DRA00.PDX");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("https://playlist.example/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/folder.json")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ entries: [
        { id: "a", title: "Remote folder A", mdrUrl: "https://playlist.example/a.mdr", pdxUrl: "https://playlist.example/DRA00.PDX" },
        { id: "b", title: "Remote folder B", mdrUrl: "https://playlist.example/b.mdr", pdxUrl: "https://playlist.example/DRA00.PDX" },
      ] }) });
      return;
    }
    if (url.endsWith(".pdx")) {
      await route.fulfill({ contentType: "application/octet-stream", body: pdxBytes });
      return;
    }
    await route.fulfill({ contentType: "application/octet-stream", body: mdrBytes });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "REMOTE URL" }).click();
  const catalogInput = page.locator('input[placeholder*="madrv-catalog"]');
  await catalogInput.fill("https://playlist.example/folder.json");
  await page.getByRole("button", { name: "Load catalog" }).click();
  await page.getByLabel("プレイリスト").waitFor({ state: "visible", timeout: 15_000 });
  const playlist = page.getByLabel("プレイリスト");
  if (!await playlist.getByText("Remote folder A").isVisible() || !await playlist.getByText("Remote folder B").isVisible()) throw new Error("Remote manifest entries were not listed.");
  await playlist.getByRole("button", { name: "Play selected" }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("プレイリスト 1 / 2") && document.body.textContent.includes("2回ループ"), undefined, { timeout: 20_000 });
  const finalDocumentText = await page.waitForFunction(() => {
    const text = document.body.textContent ?? "";
    return text.includes("プレイリスト最終曲") ? text : false;
  }, undefined, { timeout: playlistTimeoutMs }).then((handle) => handle.jsonValue());
  if (!finalDocumentText.includes("Remote folder B") || !finalDocumentText.includes("再生を停止しました")) throw new Error(`Remote playlist did not finish at the final entry: ${finalDocumentText}`);
  console.log(JSON.stringify({ remoteManifestListed: true, selectedTrackStartsWithTwoLoops: true, stoppedAtLastEntry: true }));
} finally {
  await browser.close();
}
