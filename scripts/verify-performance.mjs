import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Compare production builds with identical local network/CPU conditions.
const roots = process.argv.slice(2);
const sourcePath = process.env.MDR_OPM_SOURCE;
if (!sourcePath || !roots.length) throw new Error('Usage: MDR_OPM_SOURCE=/path/to/song.mdr node scripts/verify-performance.mjs BUILD_DIRECTORY [BASELINE_DIRECTORY]');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
try {
  for (const root of roots) {
    const server = createServer(async (req, res) => {
      try {
        const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        let file = path.join(path.resolve(root), relative);
        if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
        res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
        res.end(await readFile(file));
      } catch { res.statusCode = 404; res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__audioProbe = { frames: 0, peak: 0 };
      const createGain = AudioContext.prototype.createGain;
      let firstGain = true;
      AudioContext.prototype.createGain = function () {
        const gain = createGain.call(this);
        if (firstGain) {
          firstGain = false;
          const analyser = this.createAnalyser();
          analyser.fftSize = 2048;
          gain.connect(analyser);
          const samples = new Float32Array(2048);
          setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            let peak = 0;
            for (const value of samples) peak = Math.max(peak, Math.abs(value));
            window.__audioProbe.masterPeak = Math.max(window.__audioProbe.masterPeak ?? 0, peak);
          }, 25);
        }
        return gain;
      };
      const original = AudioContext.prototype.createScriptProcessor;
      AudioContext.prototype.createScriptProcessor = function (...args) {
        const node = original.apply(this, args);
        Object.defineProperty(node, 'onaudioprocess', { set(callback) {
          node.addEventListener('audioprocess', event => {
            callback(event);
            const samples = event.outputBuffer.getChannelData(0);
            window.__audioProbe.frames += samples.length;
            for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel++) {
              for (const sample of event.outputBuffer.getChannelData(channel)) window.__audioProbe.peak = Math.max(window.__audioProbe.peak, Math.abs(sample));
            }
          });
        } });
        return node;
      };
    });
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    if (process.env.MDR_SF_PATH) await page.route('https://raw.githubusercontent.com/**', route => route.abort());
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      await page.goto(/^https?:/.test(root) ? root : `http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
      const initial = await page.evaluate(() => ({
        jsBytes: performance.getEntriesByType('resource').filter(e => /\.js$/.test(e.name)).reduce((n,e) => n + e.decodedBodySize, 0),
        fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        guideLoaded: performance.getEntriesByType('resource').some(e => e.name.includes('FormatGuideDialog')),
      }));
      if (process.env.MDR_SF_PATH) {
        await page.locator('input[type="file"][accept*=".sf2"]').setInputFiles(process.env.MDR_SF_PATH);
        await page.getByTestId('playback-notice').filter({ hasText: 'GS MIDI出力用のSoundFontを読み込みました' }).waitFor({ timeout: 60000 });
      }
      await page.getByTestId('format-guide-button').click();
      await page.getByTestId('format-guide-body').filter({ hasText: 'MADRV' }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'LOCAL FILE', exact: true }).click();
      await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles(sourcePath);
      await page.getByTestId('playback-notice').filter({ hasText: 'トラックを検出' }).waitFor();
      console.log('Loaded:', await page.getByTestId('playback-notice').textContent());
      if (process.env.MDR_INFINITE === '1') await page.getByLabel('無限ループを切り替える').click();
      await page.getByRole('button', { name: '再生', exact: true }).click();
      console.log('Play:', await page.getByTestId('playback-notice').textContent());
      await page.waitForFunction((master) => (master ? window.__audioProbe.masterPeak : window.__audioProbe.peak) > 0, process.env.MDR_PROBE_MASTER === "1", { timeout: 15000 }).catch(async error => { console.error(await page.getByTestId('playback-notice').textContent(), await page.evaluate(() => window.__audioProbe)); throw error; });
      const audio = await page.evaluate(() => window.__audioProbe);
      const playback = await page.getByTestId('playback-marker').getAttribute('style');
      await page.getByRole('button', { name: '停止', exact: true }).first().click();
      if (errors.length) throw new Error(errors.join('\n'));
      const wasm = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.endsWith('.wasm')).map(e => ({ name: e.name.split('/').pop(), startMs: e.startTime, durationMs: e.duration })));
      console.log(JSON.stringify({ root, ...initial, playback, audio, wasm, errors }));
    } finally { await context.close(); await new Promise(resolve => server.close(resolve)); }
  }
} finally { await browser.close(); }
