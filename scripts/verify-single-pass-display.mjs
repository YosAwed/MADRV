import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4174";
const out = process.env.DISPLAY_REPORT_DIR ?? "/tmp/madrv-single-pass-display";
await mkdir(out, { recursive: true });
// A real MDR L loop with a 12-tick intro and a 144-tick C/E/G body.
// At the default Timer-B rate: first pass 2.236416 s, body 2.064384 s.
const header = Buffer.from("One-pass display diagnostic\r\n\x1aNONE\0");
const table = Buffer.alloc(66);
const body = Buffer.from([0xfd, 0, 0xfb, 15, 0xb0, 47, 0xb4, 47, 0xb7, 47]);
const jump = Buffer.alloc(3);
jump[0] = 0xf1;
jump.writeInt16BE(-(body.length + 3), 1);
const tracks = Array.from({ length: 32 }, (_, index) => index === 0
  ? Buffer.concat([Buffer.from([0xe0, 0xff, 0xe0, 0x08, 0x80, 11]), body, jump])
  : Buffer.from([0xf1, 0]));
let offset = 66;
tracks.forEach((track, index) => { table.writeUInt16BE(offset, 2 + index * 2); offset += track.length; });
table.writeUInt16BE(offset, 0);
const fixture = Buffer.concat([header, table, ...tracks]);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
});

async function verify(loops) {
  const page = await browser.newPage({ viewport: { width: loops === 4 ? 390 : 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__displaySamples = [];
    window.__displayNotes = [];
    const output = { id: "display-probe", name: "Display probe", send(data) {
      if ((data[0] & 0xf0) === 0x90 && data[2] > 0) window.__displayNotes.push({ at: performance.now(), note: data[1] });
    } };
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => ({ outputs: new Map([[output.id, output]]) }) });
  });
  await page.route("https://raw.githubusercontent.com/**", route => route.abort());
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByTestId("settings-toggle").click();
  const bank = page.getByTestId("panel-toggle-soundfont");
  if (await bank.getAttribute("aria-expanded") !== "true") await bank.click();
  await page.getByRole("button", { name: "External MIDI", exact: true }).click();
  await page.getByRole("button", { name: "LOCAL FILE", exact: true }).click();
  await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles({ name: "single-pass.mdr", mimeType: "application/octet-stream", buffer: fixture });
  await page.getByTestId("settings-toggle").click();
  if (loops > 0) {
    await page.getByRole("button", { name: "Add current", exact: true }).click();
    await page.getByTestId("playlist-entry-0").locator("..").locator('input[type="number"]').fill(String(loops));
  } else await page.getByRole("button", { name: "無限ループを切り替える", exact: true }).click();
  await page.evaluate(() => {
    window.__displayTimer = setInterval(() => {
      const read = id => document.querySelector(`[data-testid="${id}"]`)?.textContent;
      window.__displaySamples.push({ at: performance.now(), state: read("playback-state"), time: read("playback-elapsed"), percent: parseInt(read("playback-position")) });
    }, 25);
  });
  if (loops > 0) await page.getByTestId("playlist-entry-0").click();
  else await page.getByRole("button", { name: "再生", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "PLAYING");
  assert.match(await page.getByTestId("playback-elapsed").textContent(), /\/ 0:02$/);
  if (loops > 0) await page.waitForFunction(() => document.querySelector('[data-testid="playback-state"]').textContent === "READY", null, { timeout: 25000 });
  else await page.waitForTimeout(12000);
  const capture = await page.evaluate(() => {
    clearInterval(window.__displayTimer);
    return { samples: window.__displaySamples, notes: window.__displayNotes };
  });
  const playing = capture.samples.filter(sample => sample.state === "PLAYING");
  assert.ok(playing.length > 50);
  assert.ok(playing.every(sample => sample.time.endsWith("/ 0:02")), "Duration must remain one pass at every repeat");
  const wraps = playing.filter((sample, index) => index > 0 && playing[index - 1].percent > 70 && sample.percent < 30);
  assert.ok(wraps.length >= (loops || 4), `Missing one-pass resets for loops=${loops}`);
  assert.ok(Math.abs((wraps[0].at - playing[0].at) / 1000 - 2.236416) < 0.5);
  for (let index = 1; index < wraps.length; index++) assert.ok(Math.abs((wraps[index].at - wraps[index - 1].at) / 1000 - 2.064384) < 0.5);
  assert.ok(capture.notes.length >= 6, "Real MIDI extraction and scheduling must continue across the boundary");
  if (loops > 0) {
    assert.equal(playing.at(-1).percent, 100, "The final release must hold 100%, not start another pass");
    assert.equal(await page.getByTestId("playback-position").textContent(), "100%");
  } else {
    assert.equal(await page.getByTestId("playback-state").textContent(), "PLAYING");
    await page.getByRole("button", { name: "停止", exact: true }).last().click();
  }
  await page.screenshot({ path: `${out}/loops-${loops}.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
  return { loops, wraps: wraps.map(sample => Number(((sample.at - playing[0].at) / 1000).toFixed(3))), finalPercent: playing.at(-1).percent, noteCount: capture.notes.length, errors };
}

try {
  const results = await Promise.all([1, 2, 4, 0].map(verify));
  await writeFile(`${out}/report.json`, JSON.stringify({ baseUrl, results }, null, 2));
  console.log(JSON.stringify({ baseUrl, results }, null, 2));
} finally { await browser.close(); }
