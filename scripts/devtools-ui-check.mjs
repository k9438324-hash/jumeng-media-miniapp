import automator from 'miniprogram-automator';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync,mkdirSync } from 'node:fs';
const mini=await automator.connect({wsEndpoint:process.env.WECHAT_AUTO_ENDPOINT||'ws://127.0.0.1:9420'});
const checks=[];
const call=(name,...args)=>mini.evaluate((method,values)=>{const p=getCurrentPages()[0];return p[method].apply(p,values);},name,args);
async function until(f,label){for(let i=0;i<100;i++){try{if(await f())return;}catch{}await delay(200);}throw Error('超时：'+label);}
const rect=selector=>mini.evaluate(s=>new Promise(resolve=>wx.createSelectorQuery().select(s).boundingClientRect(resolve).exec()),selector);
try{
 await until(async()=>!!await mini.currentPage(),'页面编译');
 let p=await mini.switchTab('/pages/sop/index');
 if(await p.data('lesson'))await call('back');await delay(300);
 assert.equal((await p.$$('.categories button')).length,5);checks.push('五类横向选择与原数据');
 await (await p.$('.case-row')).tap();await until(async()=>!!await p.data('shot'),'打开案例');
 const video=await rect('.reference-video');const height=await mini.evaluate(()=>wx.getWindowInfo().windowHeight);
 assert.ok(video.height<=height*.46+2);checks.push('原生视频容器不超过可视高度46%');
 const action=await rect('.sop-action');assert.ok(action.height>=44);assert.ok(action.bottom<=height+2);checks.push('照拍主操作固定于页面底部并具备触控高度');
 await call('bringToAI');await delay(800);p=await mini.currentPage();
 await until(async()=>await p.data('conversation')&&!(await p.data('connecting')),'AI上下文');
 assert.ok(await p.data('contextLabel'));checks.push('原SOP上下文完整保留');
 const composer=await rect('.composer');assert.ok(composer.height>44);checks.push('底部输入区正常挂载');
 await call('keyboardChange',{detail:{height:260}});await delay(300);
 assert.equal(await p.data('keyboardHeight'),260);assert.equal(await p.data('scrollTarget'),'messages-end');
 await call('inputBlur');assert.equal(await p.data('keyboardHeight'),0);checks.push('键盘高度事件与滚底、收起状态（非真机键盘）');
 await call('showHistory');await until(async()=>await p.data('historyOpen'),'历史面板');assert.ok(await rect('.history-sheet'));
 assert.ok((await p.data('historyGroups')).length);await call('closeHistory');checks.push('原历史接口与按日期分组列表');
 await call('newConversation');await until(async()=>!(await p.data('connecting')),'清除上下文');
 assert.equal(await p.data('contextLabel'),'');assert.equal((await p.data('conversation')).messages.length,0);checks.push('清除上下文沿用新建空白对话语义');
 for(const [error,kind] of [['网络连接失败','error'],['此微信账号未开通使用权限','warning'],['今日调用额度已用完','warning']]){
  await call('fail',{message:error},'init');
  // Error跨协议不保留原型，状态文案通过展示数据单独设置，仅检查布局。
  await p.setData({error,errorKind:kind});assert.ok(await rect('.notice'));
 }
 await p.setData({error:'',errorKind:'error'});checks.push('网络、未开通及额度状态均有可见布局（展示夹具已清除）');
 const original=await p.data('conversation');
 const long='布局验收长文本，检查中文与换行。'.repeat(60)+'\n第二段保持换行。';
 await p.setData({conversation:{...original,messages:[{role:'user',content:long},{role:'assistant',content:long}]},isMock:true,partial:'布局验收：生成中的文字',busy:true,status:'正在生成…'});
 await delay(300);
 const widths=await mini.evaluate(()=>new Promise(resolve=>wx.createSelectorQuery().selectAll('.message-text').boundingClientRect(resolve).exec()));
 const windowWidth=await mini.evaluate(()=>wx.getWindowInfo().windowWidth);
 assert.ok(widths.length>=2);assert.ok(widths.every(r=>r.width<=windowWidth));
 assert.ok(await rect('.mode-tag'));assert.ok(await rect('.send'));checks.push('超长中文、多行消息、模拟标签和生成中布局');
 await p.setData({busy:false,partial:'',status:'已停止生成',canRegenerate:true});assert.ok(await rect('.generation-state'));checks.push('已停止与重新生成入口布局');
 await p.setData({connecting:true});assert.ok(await rect('.skeleton'));checks.push('加载骨架布局');
 await p.setData({conversation:original,connecting:false,busy:false,partial:'',status:'',canRegenerate:false,isMock:false});
 // 恢复服务端实际模式，展示夹具不落库、不伪造回复。
 await call('initialize');
 const report={at:new Date().toISOString(),checks,generatedImages:false,modelCalls:0,phone:false,keyboard:'模拟高度事件，待真机键盘验收'};
 mkdirSync('test-results/ui',{recursive:true});writeFileSync('test-results/ui/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await mini.disconnect();}
