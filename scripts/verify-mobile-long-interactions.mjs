import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const observationMs = Number(process.env.MOBILE_LONG_OBSERVATION_MS ?? "30000");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

async function verifyRun(page, { format, files, requiredDiagnostics }) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(files);
  await page.getByRole("button", { name: "再生" }).click();
  const marker = page.getByTestId("playback-marker");
  await marker.waitFor({ state: "visible" });
  await page.getByTestId("mobile-track-activity").first().waitFor({ state: "visible", timeout: 10_000 });
  for (const diagnostic of requiredDiagnostics) {
    await page.getByLabel(diagnostic).filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 15_000 });
  }
  const initialMarker = await marker.getAttribute("style");
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-testid="mobile-track-activity"]')).some((element) => /\d+ keys/.test(element.textContent ?? "")), undefined, { timeout: observationMs });
  await page.waitForTimeout(Math.max(0, observationMs - 2_000));
  const finalMarker = await marker.getAttribute("style");
  if (!initialMarker || !finalMarker || initialMarker === finalMarker) throw new Error(`${format} playback marker did not advance during mobile observation`);
  await page.getByLabel("停止").click();
  await page.getByLabel("Timer-B値").filter({ hasText: "—" }).waitFor({ state: "visible", timeout: 5_000 });
  return { format, initialMarker, finalMarker };
}

try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const mdx = await verifyRun(page, { format: "mdx", files: ["/home/ubuntu/Downloads/DRA02.MDX", "/home/ubuntu/Downloads/DRA00.PDX"], requiredDiagnostics: ["Timer-B値", "推定BPM"] });
  const mdr = await verifyRun(page, { format: "mdr", files: ["/home/ubuntu/upload/HECT_GS2.MDR"], requiredDiagnostics: ["MXDRV再生位置", "GS MIDI同期差"] });
  console.log(JSON.stringify({ observationMs, mdx, mdr, mobileLongInteractionRegression: true }));
} finally {
  await browser.close();
}
