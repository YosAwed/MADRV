import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const sourcePath = process.env.MDR_METADATA_SOURCE ?? "/home/ubuntu/webdev-static-assets/track-keyboard-opm-midi-test.mdr";
const pdxPath = process.env.MDR_METADATA_PDX ?? "";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles([sourcePath, ...(pdxPath ? [pdxPath] : [])]);
  const metadata = page.getByLabel("MDR metadata");
  await metadata.waitFor({ state: "visible", timeout: 20_000 });
  await metadata.getByText("MDR title").waitFor();
  await metadata.getByText("Required PDX").waitFor();
  await metadata.getByText("OPM / PCM tracks").waitFor();
  await metadata.getByText("GS MIDI tracks").waitFor();
  await metadata.getByText("Estimated duration").waitFor();
  try {
    await page.waitForFunction(() => {
      const panel = document.querySelector('[aria-label="MDR metadata"]');
      return Boolean(panel?.textContent?.match(/Estimated duration[\s\S]*\d{2}:\d{2}\.\d{3}/));
    }, undefined, { timeout: 30_000 });
  } catch {
    throw new Error(`Estimated duration did not resolve: ${await metadata.textContent()}`);
  }
  console.log(JSON.stringify({ sourcePath, metadata: metadata ? "complete" : "missing" }));
} finally {
  await browser.close();
}
