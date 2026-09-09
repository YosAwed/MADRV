import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const out = process.env.LOADING_REPORT_DIR ?? "/tmp/madrv-source-loading";
const fixture = await readFile(new URL("../client/public/manus-storage/signal-deck-diagnostic_d91a1673.mdr", import.meta.url));
// Route the diagnostic note to OPM channel 0 so no SoundFont is needed.
const tableOffset = fixture.indexOf(0, fixture.indexOf(0x1a) + 1) + 1;
const trackOffset = tableOffset + fixture.readUInt16BE(tableOffset + 2);
assert.deepEqual([...fixture.subarray(trackOffset, trackOffset + 5)], [0xe0, 0xff, 0xe0, 0x08, 0x80]);
fixture[trackOffset + 4] = 0;
fixture[trackOffset + 6] = 0x7f;
const entries = ["Slow track", "Latest track", "Failed track"].map((title, index) => ({
  id: `remote:loading-${index}`, title, format: "mdr", origin: "remote", loopCount: 99,
  remoteMdrUrl: new URL(`/loading-regression/${index}.mdr`, baseUrl).href,
}));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const report = { baseUrl, checks: [] };

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://raw.githubusercontent.com/**", route => route.abort());
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.addInitScript(entries => {
    if (!localStorage.getItem("madrv-player.playlist-v1")) {
      localStorage.setItem("madrv-player.playlist-v1", JSON.stringify(entries));
    }
    const connect = AudioNode.prototype.connect;
    const inputs = new WeakMap();
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (this instanceof GainNode && destination instanceof GainNode) inputs.set(destination, this);
      if (this instanceof GainNode && destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        connect.call(this, analyser);
        window.__loadingAudio = { output: this, master: inputs.get(this), analyser };
      }
      return result;
    };
  }, entries);

  const pending = [];
  await page.route("**/loading-regression/*.mdr", async route => {
    const response = await new Promise(resolve => pending.push({ url: route.request().url(), release: resolve }));
    try {
      await route.fulfill({ status: response.status ?? 200, contentType: "application/octet-stream", body: response.status ? "unavailable" : fixture });
    } catch { /* A stopped or superseded request may already be aborted. */ }
  });
  let holdWasm = false;
  let releaseWasm;
  await page.route("**/*.wasm", async route => {
    if (holdWasm) {
      holdWasm = false;
      await new Promise(resolve => { releaseWasm = resolve; });
    }
    await route.continue();
  });
  async function waitUntil(check, message, timeout = 15_000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`${message}; notice: ${await page.getByTestId("playback-notice").textContent()}`);
  }
  async function takeRequest(index) {
    await waitUntil(() => pending.some(item => item.url === entries[index].remoteMdrUrl), `No request for ${index}`);
    return pending.splice(pending.findIndex(item => item.url === entries[index].remoteMdrUrl), 1)[0];
  }
  const state = page.getByTestId("playback-state");
  const fade = page.getByRole("checkbox", { name: "読込中にフェードアウト", exact: true });
  const stop = () => page.getByRole("button", { name: "停止", exact: true }).last().click();
  const waitState = value => waitUntil(async () => await state.textContent() === value, `Expected ${value}`);
  const outputGain = () => page.evaluate(() => window.__loadingAudio.output.gain.value);
  const peak = () => page.evaluate(() => {
    const { analyser } = window.__loadingAudio;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return Math.max(...samples.map(Math.abs));
  });
  const open = async id => {
    if (["source", "recent"].includes(id) && await page.getByTestId("settings-toggle").getAttribute("aria-expanded") !== "true") await page.getByTestId("settings-toggle").click();
    const toggle = page.getByTestId(`panel-toggle-${id}`);
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  };
  async function startMml() {
    await open("source");
    await page.getByRole("button", { name: "MML SCORE", exact: true }).click();
    await page.getByLabel("MMLを入力").fill(`T60 O4 L1 V10 ${Array(30).fill("c").join(" ")}`);
    await page.getByTestId("settings-toggle").click();
    await page.getByRole("button", { name: "再生", exact: true }).click();
    await waitState("PLAYING");
    await waitUntil(async () => await peak() > 0.001, "MML output is silent");
  }
  async function assertLoading(index, title = entries[index].title) {
    await waitState("LOADING");
    assert.equal(await page.getByTestId(`playlist-entry-state-${index}`).textContent(), "LOADING");
    assert.equal(await page.getByTestId("source-title").textContent(), title);
    assert.equal(await page.getByRole("button", { name: "読み込みを中止", exact: true }).isVisible(), true);
  }

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(await page.getByTestId("settings-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(await fade.isChecked(), false);
  await startMml();
  await page.getByTestId("playlist-entry-0").click();
  const first = await takeRequest(0);
  await assertLoading(0);
  assert.match(await page.getByTestId("playlist-up-next").textContent(), /Latest track/);
  await page.waitForTimeout(750);
  assert.ok(await outputGain() > 0.99, "Fade OFF changed output volume");
  assert.ok(await peak() > 0.001, "Fade OFF silenced the previous track");
  await page.screenshot({ path: `${out}/desktop-loading.png`, fullPage: true });
  report.checks.push("Click immediately shows LOADING and selected title; fade OFF keeps previous audio audible");

  await page.getByRole("button", { name: "Next：次の曲を再生", exact: true }).click();
  const latest = await takeRequest(1);
  await assertLoading(1);
  assert.match(await page.getByTestId("playlist-up-next").textContent(), /Failed track/);
  first.release({});
  await page.waitForTimeout(150);
  await assertLoading(1);
  await stop();
  latest.release({});
  await page.waitForTimeout(200);
  await waitState("READY");
  assert.equal(await page.getByTestId("playlist-up-next").count(), 0);
  assert.ok(!await page.getByTestId("source-title").textContent().then(title => title.includes("Diagnostic")));
  report.checks.push("Rapid reselection ignores older response; STOP cancels transfer and prevents late playback");

  await fade.check();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await fade.isChecked(), true);
  await startMml();
  await page.getByTestId("playlist-entry-0").click();
  const faded = await takeRequest(0);
  await assertLoading(0);
  await waitUntil(async () => await outputGain() < 0.001, "Fade ON did not reach silence");
  await waitUntil(async () => await peak() < 0.0001, "Faded audio remains audible");
  assert.equal(await page.getByLabel("マスター音量").inputValue(), "78");
  await page.getByLabel("マスター音量").press("End");
  await page.getByLabel("マスター音量").press("ArrowLeft");
  assert.equal(await page.getByLabel("マスター音量").inputValue(), "99");
  assert.ok(await outputGain() < 0.001, "Master adjustment defeated the loading fade");
  await fade.uncheck();
  await waitUntil(async () => await outputGain() > 0.99 && await peak() > 0.001, "Turning fade OFF did not restore previous audio");
  await fade.check();
  await waitUntil(async () => await outputGain() < 0.001, "Second fade did not complete");
  await page.setViewportSize({ width: 390, height: 844 });
  await state.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/mobile-loading.png`, fullPage: true });
  await page.getByRole("button", { name: "読み込みを中止", exact: true }).click();
  faded.release({});
  await waitState("READY");
  await waitUntil(async () => await outputGain() > 0.99, "STOP left output faded");
  report.checks.push("Fade preference persists; audio fades to silence without changing master volume; OFF restores audio; cancel resets fade");

  // Hold the first WASM response to also check loading/cancellation after transfer.
  await page.setViewportSize({ width: 1366, height: 900 });
  holdWasm = true;
  await page.getByTestId("playlist-entry-1").click();
  (await takeRequest(1)).release({});
  await waitUntil(() => Boolean(releaseWasm), "Audio preparation did not request WASM");
  await assertLoading(1, "Signal Deck Diagnostic");
  await stop();
  releaseWasm();
  await page.waitForTimeout(1000);
  await waitState("READY");
  report.checks.push("LOADING continues through audio preparation; STOP prevents delayed WASM completion from starting playback");

  await page.getByTestId("playlist-entry-1").click();
  (await takeRequest(1)).release({});
  await waitState("PLAYING");
  assert.equal(await page.getByTestId("playlist-entry-state-1").textContent(), "playing");
  assert.equal(await page.getByTestId("playlist-entry-title-1").textContent(), "Signal Deck Diagnostic");
  assert.match(await page.getByTestId("playback-notice").textContent(), /Signal Deck Diagnostic/);
  await open("recent");
  assert.equal(await page.getByTestId("recent-sources").getByText("Signal Deck Diagnostic", { exact: true }).isVisible(), true);
  await waitUntil(async () => await outputGain() > 0.99, "Next song starts muted");
  await waitUntil(async () => Math.abs(await page.evaluate(() => window.__loadingAudio.master.gain.value) - 0.99) < 0.001, "Next song lost the volume set during loading");
  report.checks.push("Successful next-track playback returns to PLAYING at normal volume");
  await page.getByTestId("settings-toggle").click();

  for (const width of [1366, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = page.getByRole("group", { name: "再生状況の曲送り", exact: true });
    await controls.scrollIntoViewIfNeeded();
    const buttons = await controls.boundingBox();
    const notice = await page.getByTestId("playback-notice").boundingBox();
    const deck = await page.getByTestId("program-deck").boundingBox();
    const matrix = await page.getByTestId("panel-toggle-matrix").boundingBox();
    const playlist = await page.getByTestId("saved-playlist").boundingBox();
    assert.ok(deck && matrix && playlist);
    assert.ok(deck.width > width * 0.9, `Deck is too narrow at ${width}px`);
    assert.ok(playlist.y > matrix.y && Math.abs(playlist.x - matrix.x) < 20, "Playlist is not below the keyboard in the central deck");
    assert.equal(await page.locator("#player-settings").isVisible(), false);
    assert.equal(await page.getByRole("group", { name: "出力レベル", exact: true }).isVisible(), true);
    assert.ok(buttons && notice);
    assert.ok(buttons.x >= 0 && buttons.x + buttons.width <= width, `Navigation overflows at ${width}px`);
    assert.ok(buttons.y <= notice.y + notice.height + 10, `Navigation too far from notice at ${width}px`);
    assert.ok(await page.getByRole("button", { name: "Prev", exact: true }).count() === 1);
    assert.ok(await page.getByRole("button", { name: "Next", exact: true }).count() === 1);
    await page.screenshot({ path: `${out}/notice-navigation-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Prev：前の曲を再生", exact: true }).click();
  const previous = await takeRequest(0);
  await assertLoading(0);
  previous.release({});
  await waitState("PLAYING");
  assert.equal(await page.getByTestId("playlist-entry-state-0").textContent(), "playing");
  report.checks.push("Notice navigation stays nearby at 1366/768/390/320px; Next works during loading and Prev starts the previous track; original controls remain");

  await page.getByTestId("playlist-entry-2").click();
  const failed = await takeRequest(2);
  await assertLoading(2);
  failed.release({ status: 503 });
  await waitState("READY");
  assert.match(await page.getByTestId("playback-notice").textContent(), /HTTP 503/);
  await waitUntil(async () => await outputGain() > 0.99, "Failed transfer left output faded");
  report.checks.push("Failed transfer clears loading, preserves the HTTP error, and resets fade");

  // Simulate a playlist saved by the old UI: Recent knows the decoded title,
  // but the row still contains its original filename/catalog label.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("madrv-player.playlist-v1"));
    const track = saved.find(entry => entry.id === "remote:loading-1");
    track.title = "TRACK001.MDR";
    localStorage.setItem("madrv-player.playlist-v1", JSON.stringify(saved));
  });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByTestId("playlist-entry-title-1").textContent(), "Signal Deck Diagnostic");
  const savedTrack = await page.evaluate(() => JSON.parse(localStorage.getItem("madrv-player.playlist-v1")).find(entry => entry.id === "remote:loading-1"));
  assert.equal(savedTrack.title, "Signal Deck Diagnostic");
  assert.equal(savedTrack.loopCount, 99);
  assert.equal(savedTrack.remoteMdrUrl, entries[1].remoteMdrUrl);
  await page.evaluate(() => localStorage.removeItem("madrv-player.recent-sources-v1"));
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByTestId("playlist-entry-title-1").textContent(), "Signal Deck Diagnostic");
  report.checks.push("Decoded title matches Recent, playlist and playback notice; old saved names are repaired from Recent and remain saved after clearing history");

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.getByTestId("settings-toggle").click();
  await open("source");
  await page.getByRole("button", { name: "REMOTE URL", exact: true }).click();
  await page.getByLabel("リモートカタログJSONのURL").fill("https://example.org/catalog.json");
  await open("timing");
  await page.getByLabel("SoundFont MDR発音補正 ms", { exact: true }).fill("42");
  await page.getByLabel("SoundFont MDR発音補正 ms", { exact: true }).blur();
  await page.screenshot({ path: `${out}/settings-desktop.png`, fullPage: true });
  await page.getByTestId("settings-toggle").click();
  await page.getByTestId("settings-toggle").click();
  assert.equal(await page.getByLabel("リモートカタログJSONのURL").inputValue(), "https://example.org/catalog.json");
  assert.equal(await page.getByLabel("SoundFont MDR発音補正 ms", { exact: true }).inputValue(), "42");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByTestId("settings-toggle").getAttribute("aria-expanded"), "true");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator("#player-settings").scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/settings-mobile.png`, fullPage: true });
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  assert.equal(await page.getByTestId("settings-toggle").getAttribute("aria-expanded"), "false");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByTestId("settings-toggle").getAttribute("aria-expanded"), "false");
  report.checks.push("Settings open/close persists; source/catalog/SoundFont/timing are accessible without losing edits; deck levels remain visible; mobile settings do not overflow");

  // Let a one-loop track really finish and verify the queued title follows autoplay.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("madrv-player.playlist-v1"));
    localStorage.setItem("madrv-player.playlist-v1", JSON.stringify(saved.map(entry => ({ ...entry, loopCount: 1 }))));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("playlist-entry-0").click();
  (await takeRequest(0)).release({});
  await waitState("PLAYING");
  assert.match(await page.getByTestId("playlist-up-next").textContent(), /2 \/ 3/);
  const automatic = await takeRequest(1);
  await waitState("LOADING");
  assert.match(await page.getByTestId("playlist-up-next").textContent(), /Failed track/);
  automatic.release({});
  await waitState("PLAYING");
  await page.getByRole("button", { name: "Next：次の曲を再生", exact: true }).click();
  (await takeRequest(2)).release({});
  await waitState("PLAYING");
  assert.match(await page.getByTestId("playlist-up-next").textContent(), /最後の曲/);
  await waitState("READY");
  assert.equal(await page.getByTestId("playlist-up-next").count(), 0);
  report.checks.push("Next title follows real automatic playback; final track indicates the end; Next clears when playback completes");

  await page.reload({ waitUntil: "networkidle" });
  await open("source");
  await page.getByRole("button", { name: "MML SCORE", exact: true }).click();
  await page.getByLabel("MMLを入力").fill("@MIDI T120 O4 C4");
  const bankToggle = page.getByTestId("panel-toggle-soundfont");
  if (await bankToggle.getAttribute("aria-expanded") === "true") await bankToggle.click();
  await page.getByTestId("settings-toggle").click();
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await waitUntil(async () => await page.getByTestId("settings-toggle").getAttribute("aria-expanded") === "true", "Missing SoundFont did not reveal settings");
  await waitUntil(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "soundfont-bank-button"), "Missing SoundFont did not focus its picker");
  await waitState("READY");
  report.checks.push("MIDI playback without a bank reveals hidden settings and the folded SoundFont panel, then focuses the bank picker");
  assert.deepEqual(errors, []);
  report.errors = errors;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
