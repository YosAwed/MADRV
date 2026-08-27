import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mdxPath = process.env.PLAYLIST_MDX_PATH ?? "/home/ubuntu/Downloads/DRA02.MDX";
const pdxPath = process.env.PLAYLIST_PDX_PATH ?? "/home/ubuntu/Downloads/DRA00.PDX";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles([mdxPath, pdxPath]);
  await page.getByRole("button", { name: "Add current" }).click();
  const playlist = page.getByTestId("saved-playlist");
  await playlist.getByTestId("playlist-entry-0").waitFor({ state: "visible" });
  const title = await playlist.getByTestId("playlist-entry-title-0").textContent();
  const loopInput = playlist.getByLabel(`${title}のループ回数`);
  await loopInput.fill("3");
  await loopInput.blur();
  await page.reload({ waitUntil: "networkidle" });
  const restoredPlaylist = page.getByTestId("saved-playlist");
  const restoredTitle = await restoredPlaylist.getByTestId("playlist-entry-title-0").textContent();
  const restoredLoopCount = await restoredPlaylist.getByLabel(`${restoredTitle}のループ回数`).inputValue();
  const entryDetails = await restoredPlaylist.getByTestId("playlist-entry-path-0").textContent();
  if (title !== restoredTitle || restoredLoopCount !== "3" || !entryDetails?.includes("LOCAL")) {
    throw new Error(`Saved playlist persistence failed: ${JSON.stringify({ title, restoredTitle, restoredLoopCount, entryDetails })}`);
  }
  console.log(JSON.stringify({ title, restoredLoopCount, entryDetails, savedPlaylistUiVerified: true }));
} finally {
  await browser.close();
}
