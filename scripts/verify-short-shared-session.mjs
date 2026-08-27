import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const sharedMml = `; short-link regression\nT177 O4 L8\n${"cdefgab>c ".repeat(420)}`;
const legacyMml = "T144 O5 L8 c e g > c";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("textarea").fill(sharedMml);
  await page.getByLabel("ループ回数").fill("3");
  await page.getByRole("button", { name: "Copy short link", exact: true }).click();
  const shareInput = page.getByLabel("共有セッションリンク");
  await shareInput.waitFor({ state: "visible", timeout: 20_000 });
  const shortLink = await shareInput.inputValue();
  const shortUrl = new URL(shortLink);
  const shareId = shortUrl.searchParams.get("s");
  if (!shareId || !/^[A-Za-z0-9_-]{8}$/.test(shareId) || shortLink.length > 80) throw new Error(`Expected a compact share link, received: ${shortLink}`);

  const restored = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await restored.goto(shortLink, { waitUntil: "networkidle" });
  await restored.locator("textarea").waitFor({ state: "visible", timeout: 20_000 });
  if (await restored.locator("textarea").inputValue() !== sharedMml) throw new Error("Short link did not restore the saved MML.");
  if (await restored.getByLabel("ループ回数").inputValue() !== "3") throw new Error("Short link did not restore the loop limit.");

  const legacy = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await legacy.goto(`${baseUrl}/?sd=1&loops=2&maxSec=45&mml=${encodeURIComponent(legacyMml)}`, { waitUntil: "networkidle" });
  await legacy.locator("textarea").waitFor({ state: "visible", timeout: 20_000 });
  if (await legacy.locator("textarea").inputValue() !== legacyMml) throw new Error("Legacy parameterized link did not restore MML.");
  if (await legacy.getByLabel("ループ回数").inputValue() !== "2") throw new Error("Legacy parameterized link did not restore loop limit.");
  console.log(JSON.stringify({ shareId, shortLinkLength: shortLink.length, longMmlCharacters: sharedMml.length, shortLinkRestored: true, legacyLinkRestored: true }));
} finally {
  await browser.close();
}
