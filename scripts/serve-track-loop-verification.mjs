import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [sourcePath, soundFontPath] = process.argv.slice(2);
if (!sourcePath || !soundFontPath) throw new Error("Pass an MDR file and a SoundFont file.");
const out = process.env.TRACK_LOOP_BUILD_DIR ?? "/tmp/madrv-track-loop-browser";
await mkdir(out, { recursive: true });
await build({ stdin: { contents: 'export { SignalDeckAudio } from "./client/src/lib/madrvEngine.ts";', resolveDir: process.cwd() }, bundle: true, splitting: true, format: "esm", platform: "browser", outdir: out, entryNames: "engine", logLevel: "silent" });
const html = `<!doctype html><meta charset="utf-8"><title>Track L loop verification</title>
<button id="run">Run real SoundFont verification</button><pre id="result">Ready</pre>
<script type="module">
import {SignalDeckAudio} from '/engine.js';
const state={status:'ready',cases:[]};
const show=()=>document.querySelector('#result').textContent=JSON.stringify(state,null,2);
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;
 try {
  state.status='loading';show();
  const source=await (await fetch('/source.mdr')).arrayBuffer();
  const sf=await (await fetch('/bank.sf2')).arrayBuffer();
  await Promise.all([2,4].map(async loops=>{
   const audio=new SignalDeckAudio();audio.setMaster(0);
   const result={loops,status:'loading',peaks:[],durations:[],scheduledHats:[]};state.cases.push(result);show();
   await audio.loadSoundFontData(sf.slice(0));
   const analyser=audio.context.createAnalyser();analyser.fftSize=2048;audio.gains.midi.connect(analyser);
   const original=audio.startMdrMidiTimeline.bind(audio);
   audio.startMdrMidiTimeline=(events,startsAt,loopWindow)=>{
    result.songEnd=Math.max(...events.map(e=>e.at));result.startsAt=startsAt;
    result.scheduledHats=events.filter(e=>e.sourceTrack===0&&(e.bytes[0]&240)===144&&e.bytes[1]===42&&e.bytes[2]>0).map(e=>e.at);
    original(events,startsAt,loopWindow);
   };
   await new Promise(async(resolve,reject)=>{
    let timer;
    try {
     const info=await audio.playMdr(source,undefined,loops,(elapsed,duration)=>{
      result.elapsed=elapsed;
      if(duration!==undefined&&result.durations.at(-1)!==duration)result.durations.push(duration);
     },()=>{
      clearInterval(timer);result.status='ended';
      result.lastHat=result.scheduledHats.at(-1);result.peakAfterFiveSeconds=result.peaks.some(p=>p.at>5&&p.peak>0.00001);
      result.peakNearEnd=result.peaks.some(p=>p.at>result.songEnd-3&&p.peak>0.00001);
      result.maximumHatGap=Math.max(...result.scheduledHats.slice(1).map((at,i)=>at-result.scheduledHats[i]));
      delete result.peaks;delete result.scheduledHats;
      show();resolve();
     });
     result.firstPass=info.duration;result.status='playing';
     audio.setMdrMutedTracks(Array.from({length:31},(_,i)=>i+1));
     const samples=new Float32Array(analyser.fftSize);
     timer=setInterval(()=>{
      analyser.getFloatTimeDomainData(samples);let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));
      result.peaks.push({at:audio.context.currentTime-result.startsAt,peak});
      result.audioSeconds=Number((audio.context.currentTime-result.startsAt).toFixed(1));show();
     },100);
    }catch(error){clearInterval(timer);audio.stop();reject(error);}
   });
  }));
  state.status=state.cases.every(c=>c.peakAfterFiveSeconds&&c.peakNearEnd&&c.songEnd-c.lastHat<0.5&&c.maximumHatGap<0.3)?'passed':'failed';show();
 }catch(error){state.status='failed';state.error=String(error);show();}
};
</script>`;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
    const file = url.pathname === "/source.mdr" ? sourcePath : url.pathname === "/bank.sf2" ? soundFontPath
      : url.pathname.startsWith("/manus-storage/") ? path.join(process.cwd(), "client/public", url.pathname)
      : path.join(out, path.basename(url.pathname));
    response.setHeader("Content-Type", /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
    response.end(await readFile(file));
  } catch (error) { response.statusCode = 404; response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
console.log(`http://127.0.0.1:${server.address().port}/`);
