import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mdx = await readFile("/home/ubuntu/Downloads/DRA02.MDX");
const pdx = await readFile("/home/ubuntu/Downloads/DRA00.PDX");
const sourceUrl = "https://drive.google.com/file/d/shared-mdx-id/view?usp=drive_link";
const pdxUrl = "https://drive.google.com/file/d/shared-pdx-id/view?usp=drive_link";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const proxyRequests = [];
  await page.route("**/api/trpc/publicStorage.fetchAsset**", async (route) => {
    proxyRequests.push(route.request().postData() ?? "");
    const isSource = proxyRequests.length === 1;
    const bytes = isSource ? mdx : pdx;
    const requestedUrl = isSource ? sourceUrl : pdxUrl;
    const data = { kind: isSource ? "mdr" : "pdx", sourceUrl: requestedUrl, finalUrl: `https://drive.usercontent.google.com/download?id=${isSource ? "shared-mdx-id" : "shared-pdx-id"}`, contentType: "application/octet-stream", byteLength: bytes.byteLength, dataBase64: bytes.toString("base64") };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ result: { data: { json: data } } }]) });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "REMOTE URL" }).click();
  await page.getByPlaceholder(/song\.mdr/).fill(sourceUrl);
  await page.getByPlaceholder(/song\.pdx/).fill(pdxUrl);
  await page.getByRole("button", { name: "Load source" }).click();
  await page.getByText("リモートMDXを読込みました。", { exact: false }).waitFor({ state: "visible", timeout: 20_000 });
  const heading = await page.locator("h2.display.text-4xl").textContent();
  if (!heading || /VIEW\?USP=DRIVE_LINK/i.test(heading)) throw new Error(`Shared-link fragment leaked into title: ${heading}`);
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("Timer-B値").filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByLabel("停止").click();
  if (proxyRequests.length !== 2 || !proxyRequests[0].includes("shared-mdx-id") || !proxyRequests[1].includes("shared-pdx-id")) throw new Error(`Google Drive proxy requests were not issued for both assets: ${proxyRequests.join(" | ")}`);
  console.log(JSON.stringify({ sourceUrl, detectedFormat: "mdx", title: heading, playbackStarted: true, proxyRequests: proxyRequests.length }));
} finally {
  await browser.close();
}
