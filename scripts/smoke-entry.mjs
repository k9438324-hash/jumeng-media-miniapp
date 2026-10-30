import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const dir=mkdtempSync(resolve(tmpdir(),'jumeng-entry-'));
const child=spawn(process.execPath,['--env-file=server/.env.example','dist/server/index.js'],{
  windowsHide:true, env:{...process.env,PORT:'0',HOST:'127.0.0.1',AUTH_MODE:'mock',AI_MODE:'mock',NODE_ENV:'development',DB_PATH:resolve(dir,'db.sqlite')},stdio:['ignore','pipe','pipe'],
});
try {
  const base=await new Promise((resolveBase,reject)=>{
    let text='';const timer=setTimeout(()=>reject(new Error('服务启动超时')),10000);
    child.on('exit',code=>{clearTimeout(timer);reject(new Error('服务提前退出 '+code));});
    child.stdout.on('data',chunk=>{text+=chunk;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolveBase(match[0]);}});
  });
  assert.deepEqual(await (await fetch(base+'/health')).json(),{ok:true,authMode:'mock',aiMode:'mock'});
  const media=await fetch(base+'/media/videos/13437715451966486.mp4',{headers:{Range:'bytes=0-31'}});
  assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,32);
  console.log('服务入口烟测通过：env示例、本机启动、health、原片Range。服务随后退出。');
}finally{
  child.kill();await new Promise(r=>child.once('exit',r));rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
