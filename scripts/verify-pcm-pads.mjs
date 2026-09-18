import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright-core';
const pdx=Buffer.alloc(8*96*8+24000);
for(let bank=0;bank<8;bank++)for(let note=0;note<2;note++){
  pdx.writeUInt32BE(8*96*8,(bank*96+note)*8);
  pdx.writeUInt32BE(24000,(bank*96+note)*8+4);
}
for(let n=8*96*8;n<pdx.length;n++)pdx[n]=n%16<8?0x11:0x99;
function fixture(format) {
  const count=format==='adpcm'?9:format==='mdr'?32:16;
  const parts=Array.from({length:count},(_,index)=>{
    const voice=format==='mdr'?index-24:index-8;
    if(voice>=0 && voice<(format==='adpcm'?1:8))return Buffer.from([
      ...(format==='mdr'?[0xe0,8,voice+8]:[]),0xfc,voice%3+1,0xfb,15,0xed,4,0xfd,voice,
      ...Array.from({length:12},()=>[0x80,47,format==='adpcm'?47:15,0x81,47,format==='adpcm'?47:15]).flat(),0xf1,0]);
    return Buffer.from([...(index===0?(format==='mdr'?[0xe0,0xff,0xe8]:format==='pcm8'?[0xe8]:[]):[]),0xf1,0]);
  });
  const table=Buffer.alloc(2+count*2);let offset=table.length;
  parts.forEach((part,index)=>{table.writeUInt16BE(offset,2+index*2);offset+=part.length;});table.writeUInt16BE(offset,0);
  return Buffer.concat([Buffer.from('PCM pad display\r\n\x1aPADS\0'),table,...parts]);
}
const browser=process.env.MADRV_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const baseUrl=process.env.MADRV_E2E_BASE_URL??'http://127.0.0.1:4173';
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:3});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(baseUrl,{waitUntil:'networkidle'});
 const settings=page.getByTestId('settings-toggle');
 for(const format of ['adpcm','pcm8','mdr']){
  if(await settings.getAttribute('aria-expanded')!=='true')await settings.click();
  await page.getByRole('button',{name:'LOCAL FILE',exact:true}).click();
  await page.locator('input[type="file"][accept*=".mdx"]').setInputFiles([
   {name:format==='mdr'?'PADS.MDR':'PADS.MDX',mimeType:'application/octet-stream',buffer:fixture(format)},
   {name:'PADS.PDX',mimeType:'application/octet-stream',buffer:pdx}]);
  const expected=format==='adpcm'?1:8;
  await page.waitForFunction(expected=>document.querySelectorAll('.pcm-pad').length===expected,expected);
  const bank=page.getByTestId('pcm-pad-bank');const first=page.getByTestId('pcm-pad-1');
  assert.equal(await first.getAttribute('data-active'),'false');
  await page.getByLabel('マスター音量',{exact:true}).fill('0');await settings.click();
  await page.getByRole('button',{name:'再生',exact:true}).click();
  await page.waitForFunction(count=>Array.from({length:count},(_,v)=>{
   const pad=document.querySelector(`[data-testid="pcm-pad-${v+1}"]`);return pad?.getAttribute('data-sample-number')===String(v*96+1)&&pad?.getAttribute('data-pan')===String(v%3+1);
  }).every(Boolean),expected);
  const panMarks = await page.locator('.pcm-pad').evaluateAll(pads => pads.map(pad => ({
   pan: Number(pad.dataset.pan), active: pad.dataset.active === 'true',
   left: pad.querySelector('.pcm-pad-pan-left')?.getAttribute('data-emphasized'),
   right: pad.querySelector('.pcm-pad-pan-right')?.getAttribute('data-emphasized'),
  })));
  for (const mark of panMarks.filter(mark => mark.active)) {
   assert.equal(mark.left, String(mark.pan === 1 || mark.pan === 3));
   assert.equal(mark.right, String(mark.pan === 2 || mark.pan === 3));
  }
  if(format==='adpcm'){
   await page.waitForFunction(()=>document.querySelector('[data-testid="pcm-pad-1"]').getAttribute('data-active')==='false');
   const fade=await first.evaluate(async pad=>{
    const value=()=>({background:getComputedStyle(pad).backgroundColor,number:pad.querySelector('.pcm-pad-number').textContent});
    const start=value();await new Promise(r=>setTimeout(r,100));const middle=value();await new Promise(r=>setTimeout(r,250));return {start,middle,end:value()};
   });
   assert.equal(fade.start.number,'1');assert.equal(fade.middle.number,'1');assert.equal(fade.end.number,'1');
   assert.notEqual(fade.start.background,fade.end.background);assert.notEqual(fade.middle.background,fade.end.background);
   assert.equal(fade.end.background,'rgb(24, 28, 21)');
  }
  // At a fixed viewport the number box and its right edge must never move,
  // including transitions from one to three digits and both pan indicators.
  const metrics=await page.evaluate(async()=>{
   const states=[];for(let i=0;i<25;i++){
    states.push([...document.querySelectorAll('.pcm-pad')].map(p=>{
     const box=p.querySelector('.pcm-pad-number').getBoundingClientRect();
     return {x:box.x,width:box.width,right:box.right,value:p.getAttribute('data-sample-number'),pan:p.getAttribute('data-pan')};
    }));await new Promise(r=>setTimeout(r,60));
   }return states;
  });
  for(let v=0;v<expected;v++)for(const sample of metrics)assert.deepEqual([sample[v].x,sample[v].width,sample[v].right],[metrics[0][v].x,metrics[0][v].width,metrics[0][v].right]);
  for(const mode of ['音源別','トラック別']){
   await page.getByRole('button',{name:mode,exact:true}).click();assert.equal(await bank.locator('.pcm-pad').count(),expected);
  }
  const mute=first.getByRole('button',{name:'PCM 1のミュートをオンにする',exact:true});await mute.click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="pcm-pad-1"]').getAttribute('data-active')==='false');
  assert.equal(await first.locator('.pcm-pad-number').textContent(),'—');await first.getByRole('button',{name:'PCM 1のミュートをオフにする',exact:true}).click();
  if(expected===8){await page.getByTestId('pcm-pad-2').getByRole('button',{name:'PCM 2をソロにする',exact:true}).click();assert.equal(await first.getAttribute('data-active'),'false');await page.getByTestId('pcm-pad-2').getByRole('button',{name:'PCM 2をソロ解除にする',exact:true}).click();}
  await page.getByTestId('playback-seek').press('Home');
  await page.waitForFunction(()=>document.querySelector('[data-testid="playback-state"]').textContent==='PLAYING'&&Number(document.querySelector('[data-testid="playback-seek"]').value)<2);
  if(format==='pcm8'){
   await page.waitForFunction(()=>document.querySelectorAll('.pcm-pad[data-active="true"]').length===8);
   await bank.screenshot({path:`/tmp/madrv-pcm-pads-mobile-${process.env.MADRV_BROWSER??'chromium'}.png`});
  }
  await page.getByLabel('停止',{exact:true}).click();
  assert.equal(await page.locator('.pcm-pad[data-active="true"]').count(),0);
  assert.equal(await page.locator('.pcm-pad[data-sample-number]').count(),0);
  if(format==='pcm8'){
   for(const playlist of [false,true]){
    if(playlist)await page.getByRole('button',{name:'Add current',exact:true}).click();
    for(const width of [320,390,768,1366,1920]){
     await page.setViewportSize({width,height:900});
     for(const open of [false,true]){
      if((await settings.getAttribute('aria-expanded')==='true')!==open)await settings.click();
      const sizes=await bank.evaluate(bank=>[...bank.querySelectorAll('.pcm-pad')].map(p=>{
       const b=bank.getBoundingClientRect(),r=p.getBoundingClientRect(),t=p.querySelector('.pcm-pad-readout').getBoundingClientRect();
       const readout=p.querySelector('.pcm-pad-readout'),number=p.querySelector('.pcm-pad-number');
       const oldNumber=number.textContent,oldWidth=readout.style.getPropertyValue('--pcm-number-width');
       // Worst supported sample index must fit alongside both wave marks too.
       number.textContent='25503';readout.style.setProperty('--pcm-number-width','5ch');
       const range=document.createRange();range.selectNodeContents(number);const digits=range.getBoundingClientRect();
       const left=p.querySelector('.pcm-pad-pan-left').getBoundingClientRect(),right=p.querySelector('.pcm-pad-pan-right').getBoundingClientRect();
       const panFits=left.left>=r.left&&left.right<=digits.left&&right.left>=digits.right&&right.right<=r.right;
       number.textContent=oldNumber;readout.style.setProperty('--pcm-number-width',oldWidth);
       return {left:r.left,right:r.right,bankLeft:b.left,bankRight:b.right,width:r.width,textWidth:t.width,overflow:p.scrollWidth>p.clientWidth,panFits};
      }));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
      for(const m of sizes){assert.ok(m.left>=m.bankLeft&&m.right<=m.bankRight);assert.ok(!m.overflow,JSON.stringify({width,playlist,open,m}));assert.ok(m.panFits,JSON.stringify({width,playlist,open,m}));}
     }
    }
   }
   await page.getByRole('button',{name:'Clear',exact:true}).click();
   await page.setViewportSize({width:1366,height:900});
   if(await settings.getAttribute('aria-expanded')==='true')await settings.click();
   await page.getByRole('button',{name:'再生',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.pcm-pad[data-active="true"]').length===8);
   await bank.screenshot({path:`/tmp/madrv-pcm-pads-desktop-${process.env.MADRV_BROWSER??'chromium'}.png`});
   await page.getByLabel('停止',{exact:true}).click();await page.setViewportSize({width:390,height:844});
  }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({baseUrl,ordinary:1,pcm8:8,routedMdr:true,pan:true,fixedDigits:true,fade:true,layouts:20,mute:true,solo:true,seek:true,errors}));
}finally{await browser.close();}
