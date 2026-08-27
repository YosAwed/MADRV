import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    class FortyFourPointOneAudioContext extends NativeAudioContext {
      constructor(options) {
        super({ ...(options ?? {}), sampleRate: 44_100 });
      }
    }
    window.AudioContext = FortyFourPointOneAudioContext;
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  const fileInput = page.locator('input[type="file"][accept*=".mdr"]');
  await fileInput.setInputFiles("/home/ubuntu/webdev-static-assets/track-keyboard-opm-midi-test.mdr");
  await fileInput.setInputFiles("/home/ubuntu/Downloads/DRA00.PDX");
  await page.getByRole("button", { name: "再生" }).click();
  await page.getByLabel("AudioContext clock").getByText("44.1 kHz").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("track-key-overview").getByRole("img", { name: /OPM 1で.+が発音中です。/ }).waitFor({ state: "visible", timeout: 10_000 });
  console.log("44.1 kHz MDR AudioContext clock synchronization: passed");
} finally {
  await browser.close();
}
