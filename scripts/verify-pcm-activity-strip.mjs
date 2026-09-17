import assert from "node:assert/strict";
import { chromium, webkit } from "playwright-core";

// Original synthetic PCM samples and score; never read personal music files.
const tracks = Array.from({ length: 16 }, (_, i) =>
  Buffer.from(
    i === 0
      ? [0xe8, 0xf1, 0]
      : i < 8
        ? [0xf1, 0]
        : [
            0xfc,
            3,
            0xfb,
            15,
            0xed,
            4,
            0xfd,
            i - 8,
            ...(i > 8 ? [i - 8] : []),
            ...Array.from({ length: 8 }, () => [
              0x80, 23, 47, 0x81, 95, 47,
            ]).flat(),
            0xf1,
            0,
          ]
  )
);
const table = Buffer.alloc(34);
let offset = table.length;
tracks.forEach((track, i) => {
  table.writeUInt16BE(offset, 2 + i * 2);
  offset += track.length;
});
table.writeUInt16BE(offset, 0);
const mdx = Buffer.concat([
  Buffer.from("PCM activity display\r\n\x1aACTIVITY\0"),
  table,
  ...tracks,
]);
const pdxHeaderSize = 8 * 96 * 8;
const pdx = Buffer.alloc(pdxHeaderSize + 2048 + 24000);
// Different bank numbers alias the same sample data. Report the selected
// table entry rather than guessing from the sample address.
for (let bank = 0; bank < 8; bank++) {
  pdx.writeUInt32BE(pdxHeaderSize, bank * 96 * 8);
  pdx.writeUInt32BE(2048, bank * 96 * 8 + 4);
  pdx.writeUInt32BE(pdxHeaderSize + 2048, bank * 96 * 8 + 8);
  pdx.writeUInt32BE(24000, bank * 96 * 8 + 12);
}
for (let i = pdxHeaderSize; i < pdx.length; i++)
  pdx[i] = i % 16 < 8 ? 0x11 : 0x99;
const browser =
  process.env.MADRV_BROWSER === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
        executablePath:
          process.env.CHROME_PATH ??
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
        args: ["--autoplay-policy=no-user-gesture-required"],
      });
const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4173";
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const settings = page.getByTestId("settings-toggle");
  if ((await settings.getAttribute("aria-expanded")) !== "true")
    await settings.click();
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles([
    { name: "ACTIVITY.MDX", mimeType: "application/octet-stream", buffer: mdx },
    { name: "ACTIVITY.PDX", mimeType: "application/octet-stream", buffer: pdx },
  ]);
  await settings.click();
  const strips = page.getByTestId("pcm-activity-strip");
  await strips.nth(7).waitFor();
  assert.equal(await strips.count(), 8);
  const first = page.getByTestId("keyboard-track-8");
  await page.getByLabel("マスター音量", { exact: true }).fill("0");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(
      '[data-testid="pcm-activity-strip"][data-active="true"]'
    )
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        '[data-testid="keyboard-track-8"] [data-pcm-hit]'
      ).length >= 2,
    undefined,
    { timeout: 15000 }
  );
  await page.waitForFunction(() =>
    Array.from(
      { length: 8 },
      (_, voice) =>
        document
          .querySelector(
            `[data-testid="keyboard-track-${voice + 8}"] [data-sample-number]`
          )
          ?.getAttribute("data-sample-number") === String(voice * 96 + 1)
    ).every(Boolean)
  );
  await page.getByTestId("panel-toggle-matrix").scrollIntoViewIfNeeded();
  await page
    .locator('[data-panel="matrix"]')
    .screenshot({ path: "/tmp/madrv-pcm-history-mobile.png" });
  const historyBeforeMute = await first.locator("[data-pcm-hit]").count();
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="keyboard-track-8"] [data-active="false"]'
      ) !== null
  );
  assert.equal(
    await first
      .locator("[data-sample-number]")
      .getAttribute("data-sample-number"),
    "1",
    "retain the last sample number when the voice falls silent"
  );
  const mute = first.getByRole("button").nth(0);
  await mute.tap();
  assert.equal(await mute.getAttribute("aria-pressed"), "true");
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="keyboard-track-8"] .pcm-activity-strip.is-muted'
      ) &&
      document.querySelectorAll(
        '[data-testid="keyboard-track-8"] [data-pcm-hit]'
      ).length === 0
  );
  await mute.tap();
  const solo = page.getByTestId("keyboard-track-9").getByRole("button").nth(1);
  await solo.tap();
  assert.equal(await solo.getAttribute("aria-pressed"), "true");
  assert.equal(
    await first.getByTestId("pcm-activity-strip").getAttribute("data-active"),
    "false"
  );
  await solo.tap();
  const seek = page.getByTestId("playback-seek");
  await seek.press("Home");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="playback-state"]').textContent ===
        "PLAYING" &&
      Number(document.querySelector('[data-testid="playback-seek"]').value) < 2
  );
  for (const x of await page
    .locator("[data-pcm-hit]")
    .evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("x"))))) {
    assert.ok(
      x > 85,
      "seek must discard history from the old playback position"
    );
  }
  await page.getByLabel("停止", { exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("[data-pcm-hit]").length === 0 &&
      document.querySelectorAll(
        '[data-testid="pcm-activity-strip"][data-active="true"]'
      ).length === 0
  );
  for (const playlist of [false, true]) {
    if (playlist)
      await page
        .getByRole("button", { name: "Add current", exact: true })
        .click();
    for (const width of [320, 390, 768, 1366, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const open of [false, true]) {
        if (
          ((await settings.getAttribute("aria-expanded")) === "true") !==
          open
        )
          await settings.click();
        const metrics = await strips.evaluateAll(elements =>
          elements.map(e => {
            const k = e.getBoundingClientRect(),
              r = e.parentElement.getBoundingClientRect();
            return {
              height: k.height,
              width: k.width,
              rowWidth: r.width,
              right: k.right,
              rowRight: r.right,
            };
          })
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth),
          width
        );
        for (const metric of metrics) {
          assert.equal(metric.height, 30);
          assert.ok(
            metric.width >= metric.rowWidth / 2,
            JSON.stringify({ width, playlist, open, metric })
          );
          assert.ok(metric.right <= metric.rowRight);
        }
      }
    }
  }
  // A new selection must not carry activity from the previous song.
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-pcm-hit]")].some(
      node => Number(node.getAttribute("x")) < 75
    )
  );
  await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles({
    name: "SECOND.MDX",
    mimeType: "application/octet-stream",
    buffer: mdx,
  });
  await page
    .getByTestId("playback-notice")
    .filter({ hasText: "SECOND.MDX" })
    .waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-pcm-hit]")].every(
      node => Number(node.getAttribute("x")) > 85
    )
  );
  // File selection is asynchronous and may leave the prior transport playing.
  // Explicitly stop it before playing the new selection.
  await page.getByLabel("停止", { exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 900 });
  if ((await settings.getAttribute("aria-expanded")) === "true")
    await settings.click();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-pcm-hit]").length > 0
  );
  await page.getByTestId("panel-toggle-matrix").scrollIntoViewIfNeeded();
  await page
    .locator('[data-panel="matrix"]')
    .screenshot({ path: "/tmp/madrv-pcm-history-desktop.png" });
  await page.getByLabel("停止", { exact: true }).click();
  assert.deepEqual(errors, []);
  // MDR source slots differ from PCM voice numbers. Route slots 24..31 to
  // voices 1..8 and verify that labels follow the voice, not the source slot.
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  const mdrTracks = Array.from({ length: 32 }, (_, slot) =>
    Buffer.from(
      slot === 0
        ? [0xe0, 0xff, 0xe8, 0xf1, 0]
        : slot >= 24
          ? [0xe0, 0x08, slot - 16, ...tracks[slot - 16]]
          : [0xf1, 0]
    )
  );
  const mdrTable = Buffer.alloc(66);
  let mdrOffset = 66;
  mdrTracks.forEach((track, slot) => {
    mdrTable.writeUInt16BE(mdrOffset, 2 + slot * 2);
    mdrOffset += track.length;
  });
  mdrTable.writeUInt16BE(mdrOffset, 0);
  const mdr = Buffer.concat([
    Buffer.from("PCM routed numbers\r\n\x1aACTIVITY\0"),
    mdrTable,
    ...mdrTracks,
  ]);
  if ((await settings.getAttribute("aria-expanded")) !== "true")
    await settings.click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles({
    name: "ROUTED.MDR",
    mimeType: "application/octet-stream",
    buffer: mdr,
  });
  await page.getByTestId("keyboard-track-24").waitFor();
  await settings.click();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await page
    .waitForFunction(() =>
      Array.from(
        { length: 8 },
        (_, voice) =>
          document
            .querySelector(
              `[data-testid="keyboard-track-${voice + 24}"] [data-sample-number]`
            )
            ?.getAttribute("data-sample-number") === String(voice * 96 + 1)
      ).every(Boolean)
    )
    .catch(async error => {
      console.log(
        await page.evaluate(() => ({
          notice: document.querySelector('[data-testid="playback-notice"]')
            ?.textContent,
          state: document.querySelector('[data-testid="playback-state"]')
            ?.textContent,
          samples: [
            ...document.querySelectorAll('[data-testid="pcm-activity-strip"]'),
          ].map(e => ({
            label: e.getAttribute("aria-label"),
            number: e.querySelector("[data-sample-number]")?.textContent,
          })),
        }))
      );
      throw error;
    });
  await page.getByLabel("停止", { exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      baseUrl,
      pcmVoices: 8,
      routedMdrSamples: true,
      historyBeforeMute,
      layoutCases: 20,
      mute: true,
      solo: true,
      seek: true,
      stopClears: true,
      sourceChange: true,
      errors,
    })
  );
} finally {
  await browser.close();
}
