import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const cpuThrottle = Number(process.env.MOBILE_CPU_THROTTLE ?? "4");
const outputPath = process.env.MOBILE_PERF_OUTPUT ?? "/home/ubuntu/madrv-player-web/test-artifacts/mobile-playback-performance.json";
const sourceFormat = process.env.MOBILE_PLAYBACK_SOURCE ?? "mdx";
const measurementDurationMs = Number(process.env.MOBILE_MEASUREMENT_DURATION_MS ?? "4000");
const mdrSourcePath = process.env.MOBILE_MDR_SOURCE ?? "/home/ubuntu/webdev-static-assets/track-keyboard-opm-midi-test.mdr";
const mdrPdxPath = process.env.MOBILE_MDR_PDX;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  const workletFallbacks = [];
  const audioCallbackLateWarnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("AudioWorklet unavailable")) workletFallbacks.push(message.text());
    if (message.type() === "warning" && message.text().includes("[MADRV audio]")) audioCallbackLateWarnings.push(message.text());
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(sourceFormat === "mdr"
    ? (mdrPdxPath ? [mdrSourcePath, mdrPdxPath] : [mdrSourcePath])
    : ["/home/ubuntu/Downloads/DRA02.MDX", "/home/ubuntu/Downloads/DRA00.PDX"]);
  await page.getByRole("button", { name: "再生" }).click();
  if (sourceFormat === "mdr") {
    await page.waitForTimeout(500);
  } else {
    await page.getByLabel("Timer-B値").filter({ hasNotText: "—" }).waitFor({ state: "visible", timeout: 15_000 });
  }
  await page.getByTestId("mobile-track-activity").first().waitFor({ state: "visible", timeout: 10_000 });

  await page.evaluate((durationMs) => {
    const marker = document.querySelector('[data-testid="playback-marker"]');
    const started = performance.now();
    const initialTransform = marker?.style.transform ?? "";
    const samples = [];
    let previous = started;
    const tick = (now) => {
      samples.push(now - previous);
      previous = now;
      if (now - started < durationMs) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__madrvMobileMeasurement = { marker, initialTransform, samples };
  }, measurementDurationMs);
  await page.waitForTimeout(measurementDurationMs + 250);
  const measurement = await page.evaluate(() => {
    const measurementState = window.__madrvMobileMeasurement;
    const marker = measurementState?.marker;
    const samples = measurementState?.samples ?? [];
    const ordered = [...samples].sort((left, right) => left - right);
    const percentile = (ratio) => ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))] ?? 0;
    return {
      frames: samples.length,
      averageFrameGapMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      p95FrameGapMs: percentile(0.95),
      worstFrameGapMs: ordered.at(-1) ?? 0,
      delayedFrameCount: samples.filter((value) => value > 50).length,
      initialTransform: measurementState?.initialTransform ?? "",
      finalTransform: marker?.style.transform ?? "",
    };
  });
  const stopButton = page.getByLabel("停止");
  if (await stopButton.isVisible().catch(() => false)) await stopButton.click();
  if (workletFallbacks.length) throw new Error(`AudioWorklet fallback was used: ${workletFallbacks.join(" | ")}`);
  if (audioCallbackLateWarnings.length) throw new Error(`Audio callback exceeded its buffer deadline: ${audioCallbackLateWarnings.join(" | ")}`);
  await writeFile(outputPath, `${JSON.stringify({ sourceFormat, cpuThrottle, measurementDurationMs, audioCallbackLateWarnings, ...measurement }, null, 2)}\n`);
  console.log(JSON.stringify({ sourceFormat, mdrSourcePath: sourceFormat === "mdr" ? mdrSourcePath : undefined, cpuThrottle, measurementDurationMs, audioCallbackLateWarnings, ...measurement }));
} finally {
  await browser.close();
}
