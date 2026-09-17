import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, webkit } from "playwright-core";
import { createServer } from "node:http";
import path from "node:path";

// Real touch input on the shared control, without song files or audio mocks.
// Deferring native input notifications reproduces the old one-tap-late bug.
const bundle = await build({
  stdin: {
    contents: `import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {PlaybackPosition} from './client/src/components/PlaybackPosition';
      import './client/src/compact.css';
      window.seekCalls=[];
      function App(){
        const [elapsed,setElapsed]=useState(3);
        const [enabled,setEnabled]=useState(true);
        window.enablePosition=setEnabled;
        return <div style={{width:320,margin:20,display:'flex'}}>
          <PlaybackPosition elapsed={elapsed} duration={120} enabled={enabled} busy={false}
            unavailableReason="disabled" onSeek={s=>{window.seekCalls.push(s);setElapsed(s);}}/>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, outdir: "/virtual-position", jsx: "automatic",
  alias: { "@": path.resolve("client/src") },
  // Only the progress formatter is imported by this control. Audio scheduling
  // has its own real-AudioContext regressions; this isolates touch event order.
  plugins: [{ name: "progress-only", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/madrvEngine$/ }, () => ({ path: "progress", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const playbackProgressPercent=(e,d)=>d?100*e/d:0;" }));
  } }],
});
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script src="/stdin.js"></script>');
  } else {
    const file = bundle.outputFiles.find(file => file.path.endsWith(req.url));
    res.setHeader("Content-Type", req.url.endsWith(".css") ? "text/css" : "text/javascript");
    res.end(file?.contents);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const engine of (process.env.POSITION_BROWSERS ?? "chromium,webkit").split(",")) {
    const browser = await (engine === "webkit" ? webkit.launch({ headless: true }) : chromium.launch({
      executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
    }));
    try {
      for (const deferNativeInput of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        const slider = page.getByTestId("playback-seek");
        await slider.waitFor();
        if (deferNativeInput) await slider.evaluate(input => {
          let down = false;
          let pending = false;
          input.addEventListener("pointerdown", () => { down = true; }, true);
          for (const type of ["input", "change"]) input.addEventListener(type, event => {
            if (down) { pending = true; event.stopImmediatePropagation(); }
          }, true);
          input.addEventListener("pointerup", () => {
            down = false;
            if (pending) {
              pending = false;
              setTimeout(() => input.dispatchEvent(new Event("input", { bubbles: true })), 0);
            }
          }, true);
        });
        const bounds = await slider.boundingBox();
        const x = ratio => bounds.x + bounds.width * ratio;
        const y = bounds.y + bounds.height / 2;
        const calls = () => page.evaluate(() => window.seekCalls);
        const expectCalls = async (count, target) => {
          await page.waitForFunction(count => window.seekCalls.length === count, count, { timeout: 2000 });
          const values = await calls();
          assert.ok(Math.abs(values.at(-1) - target) < 1, `${engine}: ${JSON.stringify(values)} expected ${target}`);
          return values;
        };
        await page.touchscreen.tap(x(0.4), y);
        await expectCalls(1, 48);
        await page.touchscreen.tap(x(0.7), y);
        await expectCalls(2, 84);
        await page.mouse.move(x(0.2), y);
        await page.mouse.down();
        await page.mouse.move(x(0.55), y, { steps: 5 });
        assert.equal((await calls()).length, 2, "Do not seek during drag");
        await page.mouse.up();
        await expectCalls(3, 66);
        await page.mouse.move(x(0.4), y);
        await page.mouse.down();
        await page.mouse.move(x(1) + 30, y);
        await page.mouse.up();
        await expectCalls(4, 120);
        await page.mouse.move(x(0.4), y);
        await page.mouse.down();
        await page.evaluate(() => {
          const track = document.querySelector('.deck-position-track');
          track.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
        });
        await page.mouse.up();
        assert.equal((await calls()).length, 4, "Cancelled drag must not seek");
        await slider.press("Home");
        await expectCalls(5, 0);
        await slider.press("ArrowRight");
        await expectCalls(6, 5);
        await slider.press("End");
        await expectCalls(7, 120);
        let finalCount = 7;
        if (engine === "chromium") {
          const session = await page.context().newCDPSession(page);
          const touch = (type, ratio) => session.send("Input.dispatchTouchEvent", {
            type, touchPoints: ratio === undefined ? [] : [{ x: x(ratio), y, id: 1 }],
          });
          await touch("touchStart", 0.2);
          await touch("touchMove", 0.5);
          assert.equal((await calls()).length, 7, "Touch drag must remain a preview");
          await touch("touchEnd");
          await expectCalls(8, 60);
          await touch("touchStart", 0.3);
          await touch("touchCancel");
          assert.equal((await calls()).length, 8, "Cancelled touch must not seek");
          finalCount = 8;
          await session.detach();
        }
        await page.evaluate(() => window.enablePosition(false));
        await page.waitForFunction(() => document.querySelector('input[type=range]').disabled);
        await page.touchscreen.tap(x(0.3), y);
        assert.equal((await calls()).length, finalCount, "Disabled control must not seek");
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ engine, deferNativeInput, firstTap: true, secondTap: true, drag: true,
          capturedRelease: true, cancellation: true, touchDrag: engine === "chromium", keyboard: true, disabled: true, errors }));
        await page.close();
      }
    } finally { await browser.close(); }
  }
} finally { server.close(); }
