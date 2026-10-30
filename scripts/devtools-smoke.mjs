import automator from 'miniprogram-automator';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const mini=await automator.connect({wsEndpoint:process.env.WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420'});
const call=async(method,...args)=>{const result=await mini.evaluate((name,values)=>{const page=getCurrentPages()[0];return page[name].apply(page,values);},method,args);await delay(300);return result;};
const checks=[];mkdirSync('test-results/devtools',{recursive:true});
const record=text=>{checks.push(text);console.log('通过：'+text);};
const screenshot=async name=>{if(process.env.WECHAT_CAPTURE_SCREENSHOTS==='1')await mini.screenshot({path:'test-results/devtools/'+name+'.png'});};
async function until(check,label,seconds=15){for(let i=0;i<seconds*5;i++){if(await check())return;await delay(200);}throw Error('等待超时：'+label);}
try{
  await until(async()=>{try{const page=await mini.currentPage();return !!page&&!!(await page.$('.page'));}catch{return false;}},'工具完成编译及页面挂载',25);
  let p=await mini.switchTab('/pages/sop/index');
  if(await p.data('lesson'))await call('back');
  const categories=await p.data('categories');assert.deepEqual(categories.map(c=>c.name),['量房','开工','案例','谈单','巡检']);
  for(let i=0;i<categories.length;i++){
    const buttons=await p.$$('.category');await buttons[i].tap();
    await until(async()=>await p.data('categoryId')===categories[i].id,'切换类别');
    await delay(200);
    assert.equal(await p.data('categoryId'),categories[i].id);assert.ok((await p.data('cases')).length);
  }
  record('五类真实原生目录及案例列表');
  await (await p.$$('.category'))[0].tap();
  await until(async()=>await p.data('categoryId')==='measure','返回量房类别');
  await screenshot('directory');console.log('检查：进入照拍案例');
  await (await p.$('.case-row')).tap();await until(async()=>!!(await p.data('shot')),'照拍页');
  await call('showShot',0);await delay(300);
  assert.match(await p.data('videoSrc'),/clips\//);
  await call('next');await until(async()=>await p.data('shotIndex')===1,'下一镜');
  await call('previous');await until(async()=>await p.data('shotIndex')===0,'上一镜');
  await call('toggleFull');await until(async()=>/videos\//.test(await p.data('videoSrc')),'完整原片');
  await call('toggleFull');await until(async()=>/clips\//.test(await p.data('videoSrc')),'返回片段');record('原生分镜前后切换与完整视频入口');
  await call('next');await until(async()=>await p.data('shotIndex')===1,'准备较长片段验证暂停');
  // 原生播放器在setData后异步挂载，等待渲染完成再执行播放操作。
  await delay(1000);console.log('检查：原生播放器');await call('replay');
  await until(async()=>await mini.evaluate(()=>getCurrentPages()[0].currentTime>0.2),'本机视频实际播放时间推进');
  assert.equal(await p.data('mediaError'),'');record('本机原片分镜在模拟器实际播放');
  await screenshot('shot');
  await mini.evaluate(()=>{getApp().__sopSmoke=getCurrentPages()[0];});
  console.log('检查：切换AI');await call('bringToAI');await delay(800);
  const oldTime=await mini.evaluate(()=>getApp().__sopSmoke.currentTime);await delay(1200);
  assert.ok(Math.abs((await mini.evaluate(()=>getApp().__sopSmoke.currentTime))-oldTime)<0.15);record('切AI后原视频播放时间停止推进');
  p=await mini.currentPage();assert.equal(p.path,'pages/ai/index');
  await until(async()=>!(await p.data('connecting')),'聊天初始化');
  assert.equal(await p.data('error'),'');assert.match(await p.data('contextLabel'),/第2镜/);assert.match(await p.data('modeLabel'),/模拟|DeepSeek|真实/);
  record('SOP上下文带入AI并完成本机服务认证');
  const question='开发者工具验收：现场空间狭窄，IP怎样站位？';
  const textarea=await p.$('textarea');await textarea.input(question);
  await until(async()=>await p.data('input')===question,'原生输入事件到达页面');
  await call('send');await until(async()=>{const c=await p.data('conversation');return !(await p.data('busy'))&&c.messages.at(-1)?.role==='assistant';},'模拟聊天完成');
  assert.equal(await p.data('error'),'');assert.ok((await p.data('conversation')).messages.at(-1)?.content?.trim());record('原生输入和服务端聊天返回');
  await call('showHistory');assert.ok((await p.data('history')).length);await call('closeHistory');record('页面内历史入口');
  await screenshot('ai');
  p=await mini.switchTab('/pages/sop/index');assert.equal(await p.data('shotIndex'),1);assert.ok(await p.data('lesson'));record('切回SOP保留当前镜头');
  await mini.evaluate(()=>{delete getApp().__sopSmoke;});
  const result={at:new Date().toISOString(),environment:'WeChat developer tools simulator',ai:'mock',realDeepSeek:false,phone:false,checks};
  writeFileSync('test-results/devtools/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}catch(e){await screenshot('failure').catch(()=>{});console.error(e.message);console.error('已完成检查：'+checks.join('；'));process.exitCode=1;}
finally{await mini.evaluate(()=>{delete getApp().__sopSmoke;}).catch(()=>{});await mini.disconnect();}
