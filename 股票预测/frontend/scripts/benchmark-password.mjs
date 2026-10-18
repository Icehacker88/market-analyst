// LOCAL ONLY. Uses synthetic inputs and local workerd; never deployed or exposed by the app.
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { performance } from "node:perf_hooks";
import { writeFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const result = await build({ stdin: { contents: `
import {createPasswordCredential, verifyPassword} from './netlify/functions/_shared/password';
import {argon2id} from 'hash-wasm';
export default {async fetch(request){
 const path = new URL(request.url).pathname;
 const password='synthetic benchmark password';
 if(path==='/argon') {try{await argon2id({password,salt:'synthetic salt16',parallelism:1,iterations:2,memorySize:19456,hashLength:32});return Response.json({supported:true});}catch(e){return Response.json({supported:false,error:e.message});}}
 if(path==='/native210000' || path==='/native600000') {try{const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array(16),iterations:path==='/native210000'?210000:600000},k,256);return Response.json({supported:true});}catch(e){return Response.json({supported:false,error:e.message});}}
 const credential=createPasswordCredential(password);
 if(path==='/correctness') return Response.json({correct:(await verifyPassword(password,{password_credential:credential})).valid,wrongRejected:!(await verifyPassword('wrong',{password_credential:credential})).valid,uniqueSalt:credential.salt!==createPasswordCredential(password).salt});
 return Response.json({ok:true});
}};`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-07-01", inspectorPort: 0, outboundService(){throw new Error("Network forbidden");} });
let socket;
try {
  const probes={};
  for (const name of ["argon", "native210000", "native600000"]) probes[name]=await(await worker.dispatchFetch(`https://test/${name}`)).json();
  const coldStart=performance.now(); await(await worker.dispatchFetch("https://test/hash")).json(); const coldMs=performance.now()-coldStart;
  const correctness=await(await worker.dispatchFetch("https://test/correctness")).json();
  async function run(count, concurrency) {
    const times=[]; let next=0; const start=performance.now();
    await Promise.all(Array.from({length:concurrency},async()=>{while(next++<count){const t=performance.now();const response=await worker.dispatchFetch("https://test/hash");if(!(await response.json()).ok)throw new Error("Hash failed");times.push(performance.now()-t);}}));
    return {count,concurrency,totalMs:performance.now()-start,requestMs:times};
  }
  const sequential=await run(5,1), concurrent=await run(4,4);
  let measurements;
  try {
    const url=await worker.getInspectorURL();url.protocol="http:";
    const targets=await(await fetch(new URL("/json",url))).json();
    socket=new WebSocket(targets.find(x=>x.webSocketDebuggerUrl).webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
    let id=0;const pending=new Map();
    socket.addEventListener("message",event=>{const message=JSON.parse(event.data);const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);}});
    const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
    const before=await send("Runtime.getHeapUsage");
    await send("Profiler.enable");await send("Profiler.setSamplingInterval",{interval:100});await send("Profiler.start");
    const profiled=await run(5,1);const {profile}=await send("Profiler.stop");
    const after=await send("Runtime.getHeapUsage");
    const nodes=new Map(profile.nodes.map(n=>[n.id,n]));let activeUs=0;
    profile.samples.forEach((sample,i)=>{if(nodes.get(sample)?.callFrame.functionName!=="(idle)")activeUs+=profile.timeDeltas[i]||0;});
    measurements={localV8NonIdleSampleMs:activeUs/1000,perHashSampleMs:activeUs/5000,profiled,heapBefore:before,heapAfter:after,
      limits:"Sampling estimate and retained JS heap only; not hosted billed CPU, peak isolate memory, or a Cloudflare quota guarantee."};
  } catch(error) { measurements={unavailable:String(error)}; }
  const packageVersion=async name=>JSON.parse(await readFile(`node_modules/${name}/package.json`,"utf8")).version;
  const kdf=await build({stdin:{contents:'export {createPasswordCredential, verifyPassword} from "./netlify/functions/_shared/password";',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"esm",platform:"browser",minify:true});
  const report={capturedAt:new Date().toISOString(),runtime:{miniflare:await packageVersion("miniflare"),workerd:await packageVersion("workerd"),node:process.version,arch:process.arch,compatibilityDate:"2026-07-01"},library:await packageVersion("@noble/hashes"),scheme:"PBKDF2-HMAC-SHA256",iterations:600000,saltBytes:16,derivedBytes:32,probes,correctness,coldMs,sequential,concurrent,measurements,kdfBundleBytes:kdf.outputFiles[0].contents.length,kdfBundleGzipBytes:gzipSync(kdf.outputFiles[0].contents).length,hostedCPU:null};
  console.log(JSON.stringify(report,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+"\n");
}finally{socket?.close();await worker.dispose();}
