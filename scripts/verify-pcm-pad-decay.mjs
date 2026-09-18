import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright-core';
const pdx = Buffer.alloc(768 + 100000);
pdx.writeUInt32BE(768, 0); pdx.writeUInt32BE(100000, 4);
for (let n = 768; n < pdx.length; n++) pdx[n] = n % 16 < 8 ? 0x11 : 0x99;
function fixture(pcm8) {
  const parts = Array.from({length:pcm8?16:9}, (_, index) => Buffer.from(index === 8
    ? [0xff, 80, 0xfc, 3, 0xfb, 15, 0xed, 4, 0xf8, 8, 0x80, 95, 0x80, 95, 95, 0xf1, 0]
    : [...(index === 0 && pcm8 ? [0xe8] : []), 0xf1, 0]));
  const table = Buffer.alloc(2 + parts.length * 2); let offset = table.length;
  parts.forEach((part, index) => {table.writeUInt16BE(offset, 2 + index * 2);offset += part.length;});table.writeUInt16BE(offset, 0);
  return Buffer.concat([Buffer.from('PCM decay\r\n\x1aDECAY\0'), table, ...parts]);
}
const browser = process.env.MADRV_BROWSER === 'webkit' ? await webkit.launch({headless:true}) : await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
const baseUrl = process.env.MADRV_E2E_BASE_URL ?? 'http://127.0.0.1:4173';
try {
  const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const errors=[];page.on('pageerror', error=>errors.push(error.message));
  await page.goto(baseUrl, {waitUntil:'networkidle'});
  for (const pcm8 of [false, true]) {
    const settings = page.getByTestId('settings-toggle');
    if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
    await page.getByRole('button',{name:'LOCAL FILE',exact:true}).click();
    await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles([
      {name:'DECAY.MDX',mimeType:'application/octet-stream',buffer:fixture(pcm8)},
      {name:'DECAY.PDX',mimeType:'application/octet-stream',buffer:pdx},
    ]);
    await page.getByLabel('マスター音量',{exact:true}).fill('0');await settings.click();
    await page.getByRole('button',{name:'再生',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.pcm-pad')?.getAttribute('data-active')==='true');
    const frames = await page.locator('.pcm-pad').first().evaluate(async pad=>{
      const frames=[];const start=performance.now();
      while(performance.now()-start<10000){
        frames.push({t:performance.now()-start,active:pad.dataset.active==='true',trigger:Number(pad.dataset.trigger),color:getComputedStyle(pad).backgroundColor,number:pad.querySelector('.pcm-pad-number').textContent,animationTime:pad.getAnimations()[0]?.currentTime});
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      return frames;
    });
    const hits=[...new Set(frames.filter(f=>f.active).map(f=>f.trigger))];
    assert.equal(hits.length,2,'two identical legato notes must have distinct trigger counts');
    for (const hit of hits) {
      const on=frames.filter(f=>f.active&&f.trigger===hit);
      assert.ok(on.length>20);
      assert.notEqual(on[0].color,on.at(-1).color,'held notes decay');
      assert.ok(on[0].animationTime<160,'new note restarts its brightness');
      assert.ok(on.at(-1).animationTime>=850,'held note is not continually retriggered');
      assert.equal(on.at(-1).color,'rgb(53, 69, 31)','held PAD settles to the darker background');
      const settledOn=on.find(f=>f.t>=on[0].t+1000);
      assert.ok(settledOn,'held decay settles by the one-second observation');
      assert.equal(settledOn.color,'rgb(53, 69, 31)');
    }
    const next=frames.findIndex(f=>f.active&&f.trigger===hits[1]);
    assert.equal(frames[next-1].active,true,'retrigger is detected without a sampled note-off');
    const off=frames.findIndex((f,i)=>i>next&&!f.active);
    assert.ok(off>next,'release is observed');
    assert.notEqual(frames[off].color,'rgb(24, 28, 21)');
    const settled=frames.find(f=>f.t>=frames[off].t+350);
    assert.equal(settled.color,'rgb(24, 28, 21)');assert.equal(settled.number,'0');
    await page.getByLabel('停止',{exact:true}).click();
    assert.equal(await page.locator('.pcm-pad-number').first().textContent(),'—');
    assert.equal(await page.locator('.pcm-pad').first().evaluate(p=>p.getAnimations().length),0);
    console.log(JSON.stringify({pcm8,heldDecay:true,sameNoteRetrigger:true,release300ms:true,stopClears:true}));
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
