import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sampleDir = process.argv[2];
const buildDir = path.resolve(process.argv[3] ?? 'dist/public');
const reportPath = process.argv[4] ?? '/tmp/madrv-sample-results.json';
if (!sampleDir) throw new Error('Usage: node scripts/verify-sample-library.mjs SAMPLE_DIRECTORY [BUILD_DIRECTORY] [REPORT_JSON]');
const names = await readdir(sampleDir);
const songs = names.filter(name => /\.(mdr|mdx)$/i.test(name)).sort();
const pdx = names.filter(name => /\.pdx$/i.test(name)).map(name => path.join(sampleDir, name));
const sf = names.find(name => /\.sf2$/i.test(name));
const results = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    let file = path.join(buildDir, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  let errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.__probe = { peak: 0, audibleSamples: 0, samples: 0 };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(options) {
        super(options);
        const createGain = this.createGain.bind(this);
        let first = true;
        this.createGain = () => {
          const gain = createGain();
          if (first) {
            first = false;
            const analyser = this.createAnalyser();
            analyser.fftSize = 2048;
            gain.connect(analyser);
            const data = new Float32Array(2048);
            setInterval(() => {
              analyser.getFloatTimeDomainData(data);
              let peak = 0;
              for (const value of data) peak = Math.max(peak, Math.abs(value));
              window.__probe.peak = Math.max(window.__probe.peak, peak);
              window.__probe.samples++;
              if (peak > 0.0001) window.__probe.audibleSamples++;
            }, 25);
          }
          return gain;
        };
      }
    };
  });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  // Use the provided local bank, avoiding variable remote download timing.
  await page.route('https://raw.githubusercontent.com/**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
  if (sf) {
    await page.locator('input[type="file"][accept*=".sf2"]').setInputFiles(path.join(sampleDir, sf));
    await page.getByTestId('playback-notice').filter({ hasText: 'GS MIDI出力用のSoundFontを読み込みました' }).waitFor({ timeout: 60000 });
  }
  await page.getByRole('button', { name: 'LOCAL FILE', exact: true }).click();
  for (const name of songs) {
    errors = [];
    const bytes = await readFile(path.join(sampleDir, name));
    const pdxStart = bytes.indexOf(Buffer.from([13, 10, 26])) + 3;
    const requiredPdx = bytes.subarray(pdxStart, bytes.indexOf(0, pdxStart)).toString('utf8');
    const matchingPdx = pdx.find(file => path.basename(file).toLowerCase() === requiredPdx.toLowerCase());
    const result = { name, observationSeconds: 12, requiredPdx, pdx: matchingPdx };
    if (requiredPdx && !/^(none|untitled)$/i.test(requiredPdx) && !matchingPdx) {
      result.status = 'missing-pdx';
      results.push(result);
      await writeFile(reportPath, JSON.stringify({ sampleDir, buildDir, soundFont: sf, results }, null, 2));
      console.log(JSON.stringify(result));
      continue;
    }
    try {
      await page.locator('input[type="file"][accept*=".mdr"]').setInputFiles([path.join(sampleDir, name), ...(matchingPdx ? [matchingPdx] : [])]);
      await page.getByTestId('playback-notice').filter({ hasText: /読込みました/ }).waitFor();
      result.loaded = await page.getByTestId('playback-notice').textContent();
      await page.evaluate(() => { window.__probe = { peak: 0, audibleSamples: 0, samples: 0 }; });
      const started = performance.now();
      await page.getByRole('button', { name: '再生', exact: true }).click();
      await page.waitForFunction(() => window.__probe.peak > 0.0001, null, { timeout: 20000 });
      result.startToAudioMs = Math.round(performance.now() - started);
      await page.waitForTimeout(12000);
      result.audio = await page.evaluate(() => window.__probe);
      result.notice = await page.getByTestId('playback-notice').textContent();
      const hardwareTracks = Number(result.loaded.match(/OPM／PDX (\d+)トラック/)?.[1] ?? 0);
      result.status = errors.length ? 'error' : hardwareTracks > 0 && result.notice.includes('MDR / GS MIDI') ? 'audible-midi-fallback' : 'pass';
    } catch (error) {
      result.status = 'error';
      result.error = error.message;
      result.notice = await page.getByTestId('playback-notice').textContent().catch(() => '');
    }
    result.pageErrors = [...errors];
    await page.getByRole('button', { name: '停止', exact: true }).first().click();
    results.push(result);
    await writeFile(reportPath, JSON.stringify({ sampleDir, buildDir, soundFont: sf, results }, null, 2));
    console.log(JSON.stringify(result));
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
