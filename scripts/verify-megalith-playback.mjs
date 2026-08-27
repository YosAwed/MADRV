import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const viewport = process.env.MEGALITH_VIEWPORT === "mobile" ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const observationMs = Number(process.env.MEGALITH_OBSERVATION_MS ?? "15000");
const sampleIntervalMs = Math.max(100, Number(process.env.MDR_SAMPLE_INTERVAL_MS ?? "1000"));
const mdrPath = process.env.MDR_PLAYBACK_SOURCE ?? "/home/ubuntu/upload/MEGALITH.MDR";
const pdxPath = process.env.PDX_PLAYBACK_SOURCE;
const expectedTitle = process.env.MDR_EXPECTED_TITLE ?? "";
const naturalEndTimeoutMs = Number(process.env.MDR_NATURAL_END_TIMEOUT_MS ?? "0");
const expectHardwareProgress = process.env.MDR_EXPECT_HARDWARE_PROGRESS === "1";
const expectMidiHardwareSync = process.env.MDR_EXPECT_MIDI_HARDWARE_SYNC === "1";
const minimumMidiHardwareSyncSamples = Math.max(1, Number(process.env.MDR_MIN_MIDI_HARDWARE_SYNC_SAMPLES ?? "1"));
const expectedGsTrackCount = Number(process.env.MDR_EXPECT_GS_TRACKS ?? "-1");

function parseClock(value) {
  const match = value.match(/(\d+):(\d+)\.(\d+)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 : null;
}
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "LOCAL FILE" }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles([mdrPath, ...(pdxPath ? [pdxPath] : [])]);
  await page.getByLabel("MDR metadata").waitFor({ state: "visible", timeout: 10_000 });
  const metadata = await page.getByLabel("MDR metadata").textContent() ?? "";
  if (expectedTitle && !metadata.includes(expectedTitle)) throw new Error(`MDR metadata is missing title ${expectedTitle}: ${metadata}`);
  const liveTrackText = await page.getByTestId("track-key-overview").textContent().catch(() => "");
  if (expectedGsTrackCount >= 0) {
    const actualGsTrackCount = (liveTrackText.match(/GS \d+/g) ?? []).length;
    if (actualGsTrackCount !== expectedGsTrackCount) throw new Error(`Expected ${expectedGsTrackCount} GS tracks, got ${actualGsTrackCount}: ${liveTrackText}`);
  }
  await page.getByRole("button", { name: "再生" }).click();
  if (naturalEndTimeoutMs <= 0) await page.getByLabel("停止").waitFor({ state: "visible", timeout: 20_000 });
  const startedAt = Date.now();
  const samples = [];
  while (Date.now() - startedAt < observationMs) {
    samples.push(await page.evaluate(() => ({
      elapsed: document.querySelector('[data-testid="playback-position"]')?.textContent ?? "",
      playing: Boolean(document.querySelector('button[aria-label="停止"]')),
      notice: Array.from(document.querySelectorAll("p")).map((node) => node.textContent ?? "").find((text) => text.includes("WebAssembly") || text.includes("終了")) ?? "",
      timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent ?? "",
      hardwarePlayhead: document.querySelector('[aria-label="MXDRV再生位置"]')?.textContent ?? "",
      midiHardwareDelta: document.querySelector('[aria-label="GS MIDI同期差"]')?.textContent ?? "",
    })));
    await page.waitForTimeout(sampleIntervalMs);
  }
  if (expectHardwareProgress) {
    const measured = samples.map((sample, index) => ({ at: index * sampleIntervalMs / 1000, position: parseClock(sample.hardwarePlayhead) })).filter((sample) => sample.position !== null);
    if (measured.length < 2) throw new Error(`MXDRV playhead samples missing: ${JSON.stringify(samples)}`);
    const first = measured[0];
    const last = measured.at(-1);
    if (!first || !last || last.position - first.position < (last.at - first.at) * 0.6) throw new Error(`MXDRV playhead did not follow wall clock: ${JSON.stringify(measured)}`);
  }
  if (expectMidiHardwareSync) {
    const deltas = samples.map((sample) => Number.parseFloat(sample.midiHardwareDelta)).filter(Number.isFinite);
    if (deltas.length < minimumMidiHardwareSyncSamples) throw new Error(`GS MIDI / MXDRV delta samples missing: ${JSON.stringify(samples)}`);
    if (deltas.some((delta) => Math.abs(delta) > 350)) throw new Error(`GS MIDI / MXDRV timing drift exceeded 350 ms: ${JSON.stringify(deltas)}`);
  }
  if (naturalEndTimeoutMs > 0) {
    await page.getByRole("button", { name: "再生" }).waitFor({ state: "visible", timeout: naturalEndTimeoutMs });
  } else if (await page.getByLabel("停止").isVisible().catch(() => false)) {
    await page.getByLabel("停止").click();
  }
  await page.getByRole("button", { name: "再生" }).waitFor({ state: "visible", timeout: 5_000 });
  const afterStop = await page.evaluate(() => ({
    playing: Boolean(document.querySelector('button[aria-label="停止"]')),
    timerB: document.querySelector('[aria-label="Timer-B値"]')?.textContent ?? "",
  }));
  if (afterStop.playing || afterStop.timerB !== "—") throw new Error(`MDR did not reset after stop: ${JSON.stringify(afterStop)}`);
  await page.screenshot({ path: "/home/ubuntu/madrv-player-web/test-artifacts/mdr-playback.png", fullPage: true });
  const result = { mdrPath, pdxPath, viewport, observationMs, metadata, liveTrackText, samples, afterStop };
  await writeFile("/home/ubuntu/madrv-player-web/test-artifacts/mdr-playback.json", `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
