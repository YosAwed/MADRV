import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    const output = { id: "mock-gs", name: "Mock GS Output", send: () => undefined };
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => ({ outputs: new Map([[output.id, output]]) }) });
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "External MIDI" }).click();
  const correction = page.getByLabel("外部MIDI送出補正 ms");
  await correction.waitFor({ state: "visible", timeout: 10_000 });
  await correction.fill("35");
  await correction.blur();
  await page.waitForFunction(() => window.localStorage.getItem("madrv-player.external-midi-advance-ms") === "35", undefined, { timeout: 5_000 });
  if (await correction.inputValue() !== "35") throw new Error("External MIDI timing correction did not retain the entered value.");
  await page.getByRole("button", { name: "SoundFont", exact: true }).click();
  if (await correction.isVisible()) throw new Error("Hardware-only timing correction remained visible in SoundFont mode.");
  console.log(JSON.stringify({ hardwareCorrectionVisible: true, persistedAdvanceMs: 35, hiddenForSoundFont: true }));
} finally {
  await browser.close();
}
