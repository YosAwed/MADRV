import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(["/home/ubuntu/upload/MEGALITH.MDR", "/home/ubuntu/upload/MEGALITH.PDX"]);
  const advisor = page.getByTestId("playback-advisor");
  await advisor.getByText(/推奨:/).waitFor({ state: "visible", timeout: 15_000 });
  const autoText = await advisor.textContent();
  if (!autoText?.includes("Auto") && !autoText?.includes("auto")) throw new Error(`Automatic recommendation was not applied: ${autoText}`);
  await advisor.getByRole("button", { name: "安定優先" }).click();
  if (!(await advisor.textContent())?.includes("安定優先")) throw new Error("Stable profile was not selectable.");
  await advisor.getByRole("button", { name: "低遅延" }).click();
  if (!(await advisor.textContent())?.includes("低遅延")) throw new Error("Low-latency profile was not selectable.");
  await advisor.getByRole("button", { name: "推奨を適用" }).click();
  console.log(JSON.stringify({ automaticRecommendationVisible: true, manualStableSelectable: true, manualLowLatencySelectable: true }));
} finally {
  await browser.close();
}
