import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mdrPath = "/home/ubuntu/webdev-static-assets/signal-deck-diagnostic.mdr";
const mdxPath = "/home/ubuntu/Downloads/BOM_01.MDX";
const mdxWithPdxPath = "/home/ubuntu/Downloads/DRA02.MDX";
const pdxPath = "/home/ubuntu/Downloads/DRA00.PDX";
const mdxHeaderWithPdxExtension = {
  name: "header-with-extension.MDX",
  mimeType: "application/octet-stream",
  buffer: Buffer.from("PDX extension check\r\n\x1aDRA00.PDX\0", "binary"),
};
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  const fileInput = page.locator('input[type="file"][accept*=".mdx"]');
  const accept = await fileInput.getAttribute("accept");
  if (!accept?.toLowerCase().includes(".mdr") || !accept?.toLowerCase().includes(".mdx") || !accept?.toLowerCase().includes(".pdx")) {
    throw new Error("MDR, MDX, or PDX is missing from the local file accept filter");
  }

  await fileInput.setInputFiles(mdrPath);
  await page.getByText(/Signal Deck Diagnosticを読込みました/).waitFor({ state: "visible", timeout: 20_000 });
  await fileInput.setInputFiles(pdxPath);
  await page.getByText(/PDX「DRA00\.PDX」を追加しました。MDRと組み合わせて完全再生します。/).waitFor({ state: "visible", timeout: 20_000 });

  await fileInput.setInputFiles(mdxPath);
  await page.getByText(/MDX「BOM_01\.MDX」を読込みました/).waitFor({ state: "visible", timeout: 20_000 });
  await fileInput.setInputFiles(pdxPath);
  await page.getByText(/PDX「DRA00\.PDX」を追加しました。/).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByText("MDX / OPM + PDXをWebAssemblyで再生中です。ループ上限: 1回。").waitFor({ state: "visible", timeout: 30_000 });
  const bomPcmEngineRow = page.getByText("PCM / PDX", { exact: true }).locator("xpath=../..");
  await bomPcmEngineRow.getByText("await", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1200);
  await bomPcmEngineRow.getByText("await", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("button", { name: "停止" }).first().click();

  await fileInput.setInputFiles(mdxWithPdxPath);
  await page.getByText(/MDX「DRA02\.MDX」を読込みました。 PDX「DRA00\.PDX」を自動選択してOPM／PCM再生します。/).waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("MDX link analysis").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("Required PDX").waitFor({ state: "visible" });
  await page.getByText("dra00.PDX", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Linked PDX").waitFor({ state: "visible" });
  await page.getByText("Auto-matched").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByText("MDX / OPM + PDXをWebAssemblyで再生中です。ループ上限: 1回。").waitFor({ state: "visible", timeout: 30_000 });
  const pcmEngineRow = page.getByText("PCM / PDX", { exact: true }).locator("xpath=../..");
  // DRA02 has a measured PCM activity interval from 15.936 s through 18.309 s.
  await page.waitForTimeout(16_100);
  await page.getByText(/Active · ch [1-8]/).waitFor({ state: "visible", timeout: 5_000 });
  await pcmEngineRow.getByText("armed", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(2_500);
  await pcmEngineRow.getByText("await", { exact: true }).waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "停止" }).first().click();
  await pcmEngineRow.getByText("await", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: "/home/ubuntu/madrv-player-web/test-artifacts/local-mdx-flow.png", fullPage: true });

  const missingPdxPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await missingPdxPage.goto(baseUrl, { waitUntil: "networkidle" });
  await missingPdxPage.getByRole("button", { name: "LOCAL FILE" }).click();
  const missingPdxInput = missingPdxPage.locator('input[type="file"][accept*=".mdx"]');
  await missingPdxInput.setInputFiles(mdxWithPdxPath);
  await missingPdxPage.getByText(/MDX「DRA02\.MDX」を読込みました。 PDX「dra00\.PDX」を追加してください。/).waitFor({ state: "visible", timeout: 20_000 });
  await missingPdxPage.getByRole("button", { name: "再生" }).click();
  await missingPdxPage.getByText("このMDXはPDX「dra00.PDX」を必要とします。MDXとPDXを同時に選択するか、PDXを追加してください。").waitFor({ state: "visible", timeout: 20_000 });
  await missingPdxPage.close();

  const extensionNamePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await extensionNamePage.goto(baseUrl, { waitUntil: "networkidle" });
  await extensionNamePage.getByRole("button", { name: "LOCAL FILE" }).click();
  const extensionNameInput = extensionNamePage.locator('input[type="file"][accept*=".mdx"]');
  await extensionNameInput.setInputFiles(mdxHeaderWithPdxExtension);
  await extensionNamePage.getByText(/PDX「DRA00\.PDX」を追加してください。/).waitFor({ state: "visible", timeout: 20_000 });
  await extensionNamePage.getByText("DRA00.PDX", { exact: true }).waitFor({ state: "visible" });
  if (await extensionNamePage.getByText("DRA00.PDX.PDX", { exact: true }).count() !== 0) throw new Error("Required PDX was rendered with a duplicated extension");
  await extensionNamePage.close();

  const pairedFilesPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await pairedFilesPage.goto(baseUrl, { waitUntil: "networkidle" });
  await pairedFilesPage.getByRole("button", { name: "LOCAL FILE" }).click();
  const pairedInput = pairedFilesPage.locator('input[type="file"][accept*=".mdx"]');
  await pairedInput.setInputFiles([mdxWithPdxPath, pdxPath]);
  await pairedFilesPage.getByText(/PDX「DRA00\.PDX」を自動選択してOPM／PCM再生します。/).waitFor({ state: "visible", timeout: 20_000 });
  await pairedFilesPage.getByText("Auto-matched").waitFor({ state: "visible" });
  await pairedFilesPage.close();
  console.log("local MDX selection and playback: passed");
} finally {
  await browser.close();
}
