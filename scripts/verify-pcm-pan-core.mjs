import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createPlayer from '../client/public/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs';
const bytes = name => readFileSync(new URL('../client/public/manus-storage/' + name, import.meta.url));
const before = bytes('madrv-mdx-player-v14_09c287f0.wasm');
const after = bytes('madrv-mdx-player-v15_6c603674.wasm');
function fixture(voice, pcm8, pan) {
  const parts = Array.from({length: pcm8 ? 16 : 9}, (_, n) => Buffer.from(n === voice + 8
    ? [0xfc, pan, 0xfb, 15, 0xed, 4, 0xf7, 0x80, 23, 0xfc, (pan + 1) % 4, 47, 0xf1, 0]
    : [...(pcm8 && n === 0 ? [0xe8] : []), 0xf1, 0]));
  const table = Buffer.alloc(2 + parts.length * 2); let offset = table.length;
  parts.forEach((part,n) => { table.writeUInt16BE(offset, 2+n*2); offset += part.length; }); table.writeUInt16BE(offset,0);
  const mdx=Buffer.concat([Buffer.from('PAN check\r\n\x1aPAN\0'),table,...parts]);
  const pdx=Buffer.alloc(768+32768); pdx.writeUInt32BE(768,0);pdx.writeUInt32BE(32768,4);
  for(let n=768;n<pdx.length;n++)pdx[n]=n%16<8?0x11:0x99;
  return {mdx,pdx};
}
async function render(binary,voice,pcm8,pan) {
  const p=await createPlayer({wasmBinary:binary}); assert.equal(p._mdx_player_init(48000),0);
  const {mdx,pdx}=fixture(voice,pcm8,pan);const m=p._malloc(mdx.length),d=p._malloc(pdx.length),out=p._malloc(1024);
  p.HEAPU8.set(mdx,m);p.HEAPU8.set(pdx,d);assert.equal(p._mdx_player_load(m,mdx.length,d,pdx.length),0);p._mdx_player_play(1);
  const audio=new Int16Array(48000*2);let left=0,right=0;const pans=new Set();
  try {
    for(let frame=0;frame<48000;frame+=256){const count=Math.min(256,48000-frame);p._mdx_player_render(out,count);const block=p.HEAP16.subarray(out/2,out/2+count*2);audio.set(block,frame*2);
      for(let i=0;i<block.length;i+=2){left+=Math.abs(block[i]);right+=Math.abs(block[i+1]);}
      if(p.asm.get_pcm_pan){pans.add(p.asm.get_pcm_pan(voice));for(let other=0;other<8;other++)if(other!==voice)assert.equal(p.asm.get_pcm_pan(other),-1);}
    }
    return {audio,left,right,pans:[...pans]};
  } finally { for(const ptr of [m,d,out])p._free(ptr);p._mdx_player_dispose(); }
}
let cases=0;const mappings=[];
for(const pcm8 of [false,true])for(let voice=0;voice<(pcm8?8:1);voice++)for(const pan of [0,1,2,3]){
  const a=await render(before,voice,pcm8,pan),b=await render(after,voice,pcm8,pan);
  assert.deepEqual(a.audio,b.audio,'PAN telemetry must preserve every audio sample');
  const expected=(b.left>0?1:0)|(b.right>0?2:0);
  assert.deepEqual(b.pans.filter(value=>value>=0),[expected],`actual stereo output must match PAN, including changes while held: ${pcm8}/${voice}/${pan}`);
  if(voice===0)mappings.push({pcm8,commandPan:pan,outputPan:expected});cases++;
}
console.log(JSON.stringify({cases,bitIdentical:true,heldPan:true,mappings}));
