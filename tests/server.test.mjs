import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApplication } from '../dist/server/app.js';
import { loadConfig } from '../dist/server/config.js';
import { generate } from '../dist/server/provider.js';

async function fixture(t, overrides = {}, provider) {
  const dir = mkdtempSync(resolve(tmpdir(), 'jumeng-test-'));
  const config = { ...loadConfig({}), dbPath: resolve(dir,'db.sqlite'), port: 0, mockDelay: 5, ...overrides };
  const app = createApplication(config, provider);
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async()=>{ await app.shutdown(); rmSync(dir,{recursive:true,force:true}); });
  async function request(path, method='GET', data, token) {
    const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},body:data === undefined ? undefined : JSON.stringify(data)});
    return { status: response.status, data: await response.json() };
  }
  async function login(deviceId='test-device-alpha') { const r=await request('/auth/login','POST',{deviceId}); assert.equal(r.status,200); return r.data.token; }
  async function settle(id,token) {
    for(let i=0;i<100;i++) { const r=await request('/generations/'+id,'GET',undefined,token); if(r.data.status!=='running')return r.data; await delay(10); }
    throw new Error('job timeout');
  }
  return { app, base, request, login, settle, config };
}
test('模拟聊天：SOP上下文、进度、历史、幂等、用户隔离、持久化、取消', async t=>{
  let captured;
  const f = await fixture(t, {}, async (messages,cfg,signal,onText)=>{
    captured=messages; onText('已收到'); await delay(120,undefined,{signal}); onText('现场条件');
  });
  const a=await f.login(), b=await f.login('test-device-bravo');
  const c=(await f.request('/conversations','POST',{context:{lessonId:1,shotIndex:2}},a)).data;
  const body={requestId:'request-0001',content:'厨房很窄，业主不出镜'};
  const start=await f.request(`/conversations/${c.id}/generations`,'POST',body,a);
  assert.equal(start.status,202);
  const duplicate=await f.request(`/conversations/${c.id}/generations`,'POST',body,a);
  assert.equal(duplicate.data.id,start.data.id);
  const partial=await f.request('/generations/'+start.data.id,'GET',undefined,a);
  assert.equal(partial.data.text,'已收到');
  assert.equal((await f.request(`/conversations/${c.id}/generations`,'POST',{...body,requestId:'request-0002'},a)).status,409);
  assert.equal((await f.request('/conversations/'+c.id,'GET',undefined,b)).status,404);
  assert.equal((await f.request('/generations/'+start.data.id,'GET',undefined,b)).status,404);
  assert.equal((await f.request('/generations/'+start.data.id,'DELETE',{},b)).status,404);
  assert.equal((await f.request('/conversations','GET',undefined,b)).data.items.length,0);
  assert.equal((await f.settle(start.data.id,a)).status,'completed');
  assert.match(captured[1].content,/厨房/); assert.match(captured[1].content,/currentShot/);
  const saved=(await f.request('/conversations/'+c.id,'GET',undefined,a)).data;
  assert.equal(saved.messages.length,2); assert.equal(saved.messages[1].content,'已收到现场条件');
  assert.equal('owner' in saved,false);
  assert.equal((await f.request('/conversations','GET',undefined,a)).data.items[0].id,c.id);
  const start2=(await f.request(`/conversations/${c.id}/generations`,'POST',{requestId:'request-0003',content:'改成提问'},a)).data;
  const stopped=(await f.request('/generations/'+start2.id,'DELETE',{},a)).data;
  assert.equal(stopped.status,'stopped'); assert.equal(stopped.text,'已收到');
  const again=await f.login();
  assert.equal((await f.request('/conversations/'+c.id,'GET',undefined,again)).data.messages.length,4);
  assert.equal((await f.request('/conversations','GET')).status,401);
});
test('服务端校验：每日额度、无效SOP、输入长度和非法JSON',async t=>{
  const f=await fixture(t,{dailyLimit:1}); const token=await f.login();
  assert.equal((await f.request('/conversations','POST',{context:{lessonId:1,shotIndex:99}},token)).status,400);
  const c=(await f.request('/conversations','POST',{},token)).data;
  assert.equal((await f.request(`/conversations/${c.id}/generations`,'POST',{requestId:'req-long-1',content:'x'.repeat(4001)},token)).status,400);
  const g=(await f.request(`/conversations/${c.id}/generations`,'POST',{requestId:'req-valid-1',content:'怎么拍'},token)).data;
  await f.settle(g.id,token);
  const quota=await f.request(`/conversations/${c.id}/generations`,'POST',{requestId:'req-valid-2',content:'再次'},token);
  assert.equal(quota.status,429); assert.match(quota.data.error,/额度/);
  const malformed=await fetch(f.base+'/conversations',{method:'POST',headers:{Authorization:'Bearer '+token},body:'{broken'});
  assert.equal(malformed.status,400);
});
test('失败重试保留问题且不重复用户消息；进程重启任务转失败',async t=>{
  let calls=0;
  const f=await fixture(t,{},async (_messages,_config,_signal,onText)=>{calls++; if(calls===1){onText('部分');throw new Error('AI 连接中断');} onText('重试成功');});
  const token=await f.login(), c=(await f.request('/conversations','POST',{},token)).data;
  const g=(await f.request(`/conversations/${c.id}/generations`,'POST',{requestId:'req-failed-1',content:'请调整'},token)).data;
  assert.equal((await f.settle(g.id,token)).status,'failed');
  const retry=(await f.request(`/conversations/${c.id}/generations`,'POST',{requestId:'req-failed-2',content:'请调整'},token)).data;
  assert.equal((await f.settle(retry.id,token)).status,'completed');
  const history=(await f.request('/conversations/'+c.id,'GET',undefined,token)).data;
  assert.equal(history.messages.length,2); assert.equal(history.messages[1].content,'重试成功');
  const {Store}=await import('../dist/server/store.js');
  const owner=f.app.store.owner(token);
  const pending=f.app.store.begin(owner,c.id,'req-restart-1','重启前请求','mock',30);
  const second=new Store(f.config.dbPath);
  assert.equal(second.job(owner,pending.id).status,'failed');
  assert.match(second.job(owner,pending.id).error,/重启/);
  assert.equal(second.conversation(owner,c.id).messages.at(-1).content,'重启前请求');
  second.close();
});
test('媒体路由协议模拟：完整片、分段、Range及路径阻断（不验证解码）',async t=>{
  const root=mkdtempSync(resolve(tmpdir(),'jumeng-media-fixture-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const course=JSON.parse(readFileSync('miniprogram/data/course.json','utf8'));
  // 合成二进制只测试路由和Range，不冒充可播放的真实MP4。
  for(const file of [course.lessons[0].file,course.lessons[0].shots[0].clip]){
    mkdirSync(resolve(root,file,'..'),{recursive:true});writeFileSync(resolve(root,file),Buffer.alloc(256,7));
  }
  const f=await fixture(t,{mediaRoot:root});
  for(const file of [course.lessons[0].file,course.lessons[0].shots[0].clip]){
    const r=await fetch(f.base+'/media/'+file,{headers:{Range:'bytes=0-63'}});
    assert.equal(r.status,206); assert.equal((await r.arrayBuffer()).byteLength,64); assert.match(r.headers.get('content-range'),/^bytes 0-63\//);
  }
  const invalid=await fetch(f.base+'/media/'+course.lessons[0].file,{headers:{Range:'bytes=999999999-'}});assert.equal(invalid.status,416);
  assert.equal((await fetch(f.base+'/media/not-allowed.mp4')).status,404);
});
test('本机实际媒体：完整片及片段Range读取（跨机器可显式跳过）',async t=>{
  const root=resolve(process.env.TEST_MEDIA_ROOT || '../output/pdf/厨房视频照拍手册');
  if(!existsSync(root)){
    if(process.env.TEST_MEDIA_ROOT)assert.fail('TEST_MEDIA_ROOT指定的目录不存在');
    t.skip('未附带原媒体；配置TEST_MEDIA_ROOT后运行实际文件验证');return;
  }
  const f=await fixture(t,{mediaRoot:root});
  const course=JSON.parse(readFileSync('miniprogram/data/course.json','utf8'));
  for(const file of [course.lessons[0].file,course.lessons[0].shots[0].clip]){
    const r=await fetch(f.base+'/media/'+file,{headers:{Range:'bytes=0-63'}});
    assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,64);
  }
});
test('真实模式配置失败应明确报错，不静默模拟',()=>{
  assert.throws(()=>loadConfig({AUTH_MODE:'mock',HOST:'0.0.0.0'}),/回环/);
  assert.throws(()=>loadConfig({AI_MODE:'deepseek'}),/DEEPSEEK_API_KEY/);
  assert.throws(()=>loadConfig({AUTH_MODE:'wechat'}),/许可名单/);
  assert.throws(()=>loadConfig({NODE_ENV:'production'}),/生产环境/);
});
test('微信身份协议模拟：忽略客户端身份、校验许可名单及过期token；不代表真实微信登录',async t=>{
  const config={...loadConfig({}),authMode:'wechat',allowedOpenids:['allowed-student'],appId:'test-app',appSecret:'not-a-real-secret'};
  const f=await fixture(t,config);
  const original=globalThis.fetch;let returnedOpenid='not-allowed';
  globalThis.fetch=async (url,options)=>{
    if(String(url).startsWith('https://api.weixin.qq.com/'))return new Response(JSON.stringify({openid:returnedOpenid}));
    return original(url,options);
  };
  try{
    const rejected=await f.request('/auth/login','POST',{code:'wx-code',openid:'allowed-student'});
    assert.equal(rejected.status,403);assert.equal('token' in rejected.data,false);
    returnedOpenid='allowed-student';
    const accepted=await f.request('/auth/login','POST',{code:'wx-code'});assert.equal(accepted.status,200);
    const token=accepted.data.token;
    assert.equal((await f.request('/conversations','GET',undefined,token)).status,200);
    f.config.allowedOpenids=[];
    assert.equal((await f.request('/conversations','GET',undefined,token)).status,403);
    f.config.allowedOpenids=['allowed-student'];
    f.app.store.db.prepare('UPDATE sessions SET expires=0').run();
    assert.equal((await f.request('/conversations','GET',undefined,token)).status,401);
  }finally{globalThis.fetch=original;}
});
test('DeepSeek协议模拟：分块UTF8解析与上游失败；不是实际API验收',async()=>{
  const original=globalThis.fetch; const encoder=new TextEncoder(); let payload;
  try {
    globalThis.fetch=async (_url,options)=>{
      payload=JSON.parse(options.body);
      const bytes=encoder.encode('data: {"choices":[{"delta":{"content":"中文结果"}}]}\n\ndata: [DONE]\n\n');
      return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
    };
    let text=''; await generate([{role:'user',content:'测试'}],{...loadConfig({}),aiMode:'deepseek',deepseekKey:'test-not-real'},new AbortController().signal,t=>text+=t);
    assert.equal(text,'中文结果'); assert.equal(payload.stream,true);
    globalThis.fetch=async()=>new Response('secret upstream detail',{status:503});
    await assert.rejects(()=>generate([],{...loadConfig({}),aiMode:'deepseek'},new AbortController().signal,()=>{}),/503/);
    globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"截断"}}]}\n\n');
    await assert.rejects(()=>generate([],{...loadConfig({}),aiMode:'deepseek'},new AbortController().signal,()=>{}),/连接中断/);
  }finally{globalThis.fetch=original;}
});
