import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { harness } from './mini-harness.mjs';
const tap=(key,value)=>({currentTarget:{dataset:{[key]:value}}});
test('三个底部导航与五类真实案例，54镜必需字段齐全',()=>{
  const app=JSON.parse(readFileSync('miniprogram/app.json'));
  assert.deepEqual(app.tabBar.list.map(x=>x.text),['对标 SOP','聚梦AI','会员']);
  assert.equal(app.pages.length,4);assert.ok(app.pages.includes('pages/teacher/index'));assert.equal(app.pages[0],'pages/sop/index');
  assert.equal(app.pages[2],'pages/account/index');
  const h=harness('miniprogram/pages/sop/index.js');h.page.onLoad();
  assert.deepEqual(h.page.data.categories.map(c=>c.name),['量房','开工','案例','谈单','巡检']);
  let shots=0;
  for(const category of h.page.data.categories){
    h.page.selectCategory(tap('id',category.id));assert.ok(h.page.data.cases.length>0);
    for(const lesson of h.page.data.cases){shots+=lesson.shots.length;for(const shot of lesson.shots)for(const key of ['where','frame','action','say','stop','check','clip'])assert.ok(shot[key]);}
  }
  assert.equal(shots,54);
});
test('分段切换先暂停、完整视频、重播、离开暂停、续看和SOP带入AI',()=>{
  const h=harness('miniprogram/pages/sop/index.js'),p=h.page;p.onLoad();
  p.openCase(tap('id',1)); assert.equal(p.data.shotIndex,0);assert.match(p.data.videoSrc,/clips\//);
  const old=h.videos.length;p.next();assert.equal(h.videos[old][0],'pause');assert.equal(p.data.shotIndex,1);
  p.timeUpdate({detail:{currentTime:3.5}});p.onHide();assert.equal(h.videos.at(-1)[0],'pause');
  p.back();p.openCase(tap('id',1));assert.equal(p.data.shotIndex,1);assert.equal(p.data.initialTime,3.5);
  p.toggleFull();assert.match(p.data.videoSrc,/videos\//);p.replay();assert.deepEqual(h.videos.slice(-2).map(x=>x[0]),['seek','play']);
  p.videoError();assert.match(p.data.mediaError,/失败/);p.replay();assert.equal(p.data.mediaError,'');
  p.bringToAI();assert.deepEqual(h.storage.get('jumeng:pendingSop'),{lessonId:1,shotIndex:1});assert.equal(h.events.at(-1)[1],'/pages/ai/index');
  p.onUnload();assert.equal(h.videos.at(-1)[0],'pause');
  assert.match(readFileSync('miniprogram/pages/sop/index.wxml','utf8'),/object-fit="contain"/);
});
test('无媒体配置不输出本地路径；非法进度归一化',()=>{
  const {exports:d}=harness('miniprogram/domain.js');
  assert.equal(d.mediaUrl('','clips/test.mp4'),'');assert.equal(d.mediaUrl('D:/videos','test.mp4'),'');assert.equal(d.mediaUrl('https://cdn.example','../secret'),'');
  assert.equal(d.normalizeProgress({shotIndex:999,time:-20},6).shotIndex,5);
  assert.equal(d.normalizeProgress({shotIndex:2,time:-20},6).time,0);
});
test('聊天模拟交互：SOP带入、发送、完成、复制、历史、新建、失败与重试',async()=>{
  let serial=0, failNext=false, failAfterGeneration=false, nextRunning=false;const conversations=new Map();let currentJob;
  const h=harness('miniprogram/pages/ai/index.js',{
    request(options){queueMicrotask(()=>{
      const path=new URL(options.url).pathname,body=options.data;let data,statusCode=200;
      if(failNext){failNext=false;options.fail({});return;}
      if(path==='/auth/login')data={token:'mock-token',expiresAt:Date.now()+999999,authMode:'mock',aiMode:'mock'};
      else if(path==='/conversations'&&options.method==='POST'){data={id:'c-'+(++serial),title:'新对话',context:body.context||null,messages:[],updatedAt:Date.now()};conversations.set(data.id,data);}
      else if(path==='/conversations')data={items:[...conversations.values()]};
      else if(path.endsWith('/generations')){
        const c=conversations.get(path.split('/')[2]);c.messages.push({role:'user',content:body.content});currentJob={id:'job1',conversationId:c.id,text:'模拟结果',status:nextRunning?'running':'completed',error:'',mode:'mock'};if(!nextRunning)c.messages.push({role:'assistant',content:'模拟结果'});nextRunning=false;data=currentJob;
        if(failAfterGeneration){failAfterGeneration=false;failNext=true;}
      }else if(path.startsWith('/generations/')){
        if(options.method==='DELETE'){currentJob.status='stopped';conversations.get(currentJob.conversationId).messages.push({role:'assistant',content:currentJob.text});}
        data=currentJob;
      }
      else data=conversations.get(path.split('/')[2]);
      options.success({statusCode,data:structuredClone(data)});
    });},
  });
  const p=h.page;h.storage.set('jumeng:pendingSop',{lessonId:1,shotIndex:2});p.visible=true;await p.initialize();
  assert.match(p.data.contextLabel,/第3镜/);assert.match(p.data.modeLabel,/模拟模式/);assert.equal(h.storage.has('jumeng:pendingSop'),false);
  p.input({detail:{value:'客户不出镜'}});await p.send();assert.equal(p.data.busy,false);assert.equal(p.data.conversation.messages.length,2);
  p.copy(tap('index',1));assert.deepEqual(h.events.at(-1),['clipboard','模拟结果']);
  await p.showHistory();assert.equal(p.data.historyOpen,true);assert.equal(p.data.history.length,1);
  await p.newConversation();assert.equal(p.data.conversation.messages.length,0);assert.equal(p.data.contextLabel,'');
  p.input({detail:{value:'现场问题'}});failNext=true;await p.send();assert.match(p.data.error,/网络/);assert.equal(p.data.busy,false);
  await p.retry();assert.equal(p.data.error,'');assert.equal(p.data.conversation.messages.at(-1).content,'模拟结果');
  p.input({detail:{value:'已提交后断网'}});failAfterGeneration=true;await p.send();
  assert.match(p.data.error,/网络/);assert.equal(p.action,'poll');assert.equal(p.data.busy,true);
  await p.retry();assert.equal(p.data.busy,false);assert.equal(p.data.conversation.messages.length,4);
  nextRunning=true;p.input({detail:{value:'可以停止吗'}});await p.send();assert.equal(p.data.busy,true);
  await p.stop();assert.equal(p.data.busy,false);assert.match(p.data.status,/停止/);assert.equal(p.data.conversation.messages.length,6);
  p.onHide();await delay(1);
});
test('带入新SOP查询未知发送结果，不创建或扣费生成任务',async()=>{
  let generationCreates=0;
  const h=harness('miniprogram/pages/ai/index.js',{
    request(o){queueMicrotask(()=>{
      const path=new URL(o.url).pathname;let statusCode=200,data;
      if(path==='/auth/login')data={token:'test',expiresAt:Date.now()+999999,authMode:'mock',aiMode:'mock'};
      else if(path.includes('/by-request/')){statusCode=404;data={error:'任务不存在'};}
      else if(path.endsWith('/generations')&&o.method==='POST'){generationCreates++;data={id:'unexpected',conversationId:'old',status:'running',text:'',error:'',mode:'mock'};}
      else if(path.startsWith('/generations/'))data={id:'unexpected',conversationId:'old',status:'stopped',text:'',error:'',mode:'mock'};
      else data={id:'new',title:'新对话',context:{lessonId:1,shotIndex:0},messages:[],updatedAt:Date.now()};
      o.success({statusCode,data});
    });},
  });
  const prefix='jumeng:chat:mock:http://127.0.0.1:8787:';
  h.storage.set(prefix+'pendingSend',{conversationId:'old',requestId:'lost-request-1',content:'上次没送达'});
  h.storage.set('jumeng:pendingSop',{lessonId:1,shotIndex:0});
  h.page.visible=true;await h.page.initialize();
  assert.equal(generationCreates,0);assert.equal(h.page.data.conversation.id,'new');assert.equal(h.storage.has(prefix+'pendingSend'),false);
});
test('生成任务404清理恢复状态，退出生成中并允许重新发送',async()=>{
  const h=harness('miniprogram/pages/ai/index.js',{
    request(o){queueMicrotask(()=>o.success({statusCode:new URL(o.url).pathname==='/auth/login'?200:404,data:new URL(o.url).pathname==='/auth/login'?{token:'test',expiresAt:Date.now()+999999,authMode:'mock',aiMode:'mock'}:{error:'生成任务不存在'}}));},
  });
  const prefix='jumeng:chat:mock:http://127.0.0.1:8787:';
  h.storage.set(prefix+'job',{conversationId:'old',id:'lost'});
  h.page.jobId='lost';h.page.data.busy=true;h.page.data.conversation={id:'old',messages:[{role:'user',content:'待重试的问题'}]};
  await h.page.poll();assert.equal(h.page.data.busy,false);assert.equal(h.page.jobId,'');assert.equal(h.storage.has(prefix+'job'),false);assert.equal(h.page.action,'send');
});

test('会员页显式登录、用量展示、刷新失败不显示过期余额',async()=>{
  let fail=false,calls=0;
  const h=harness('miniprogram/pages/account/index.js',{
    request:o=>{
      calls++;
      if(o.url.endsWith('/auth/login'))return o.success({statusCode:200,data:{token:'account-token',expiresAt:Date.now()+86400000,authMode:'mock',aiMode:'mock'}});
      if(fail)return o.success({statusCode:401,data:{error:'登录已过期'}});
      return o.success({statusCode:200,data:{membership:{label:'体验',startsAt:0,expiresAt:86400000,quota:10,used:2},status:'active',remaining:8,todayUsed:2,dailyLimit:30,records:[{id:'job',at:0,status:'completed',mode:'mock',charged:1}]}});
    }
  });
  let selected;h.page.getTabBar=()=>({setData:data=>{selected=data.selected;}});
  h.page.onShow();assert.equal(calls,0);assert.equal(selected,2);
  await h.page.refresh();assert.equal(h.page.data.account.remaining,8);assert.equal(h.page.data.statusLabel,'使用中');
  assert.match(h.page.data.records[0].time,/1970\/1\/1 08:00/);assert.equal(h.page.data.records[0].status,'已完成');
  fail=true;await h.page.refresh();assert.equal(h.page.data.account,null);assert.match(h.page.data.error,/过期/);assert.equal(h.page.data.loading,false);
});

test('目录随课程增长：新案例置前、动态数量、搜索与空分类',()=>{
  const course=JSON.parse(readFileSync('miniprogram/data/course.json','utf8'));
  const template=course.lessons[0];
  course.lessons=Array.from({length:21},(_,index)=>({...template,id:index+100,name:'案例'+index}));
  course.categories[0].lessonIds=course.lessons.map(l=>l.id);course.categories[1].lessonIds=[];
  const h=harness('miniprogram/pages/sop/index.js',{}, {
    [resolve('miniprogram/data/course.js')]:{__esModule:true,default:course}
  });
  const p=h.page;p.onLoad();p.onShow();
  assert.equal(p.data.caseCount,21);assert.equal(p.data.showSearch,true);
  assert.equal(p.data.visibleCases[0].id,120);
  p.toggleSearch();p.search({detail:{value:'案例20'}});assert.equal(p.data.visibleCases.length,1);
  p.openCase(tap('id',120));p.back();assert.equal(p.data.visibleCases[0].isNew,false);
  p.selectCategory(tap('id','start'));assert.equal(p.data.caseCount,0);assert.equal(p.data.visibleCases.length,0);assert.equal(p.data.showSearch,false);
});

test('Logo 菜单：展开收起、忙碌禁用、点击执行一次、切页关闭',()=>{
  const h=harness('miniprogram/components/brand-menu/index.js'),p=h.page,commands=[];
  p.properties.items=[{label:'新对话',action:'new',guarded:true},{label:'历史',action:'history',guarded:true}];
  p.triggerEvent=(name,detail)=>commands.push({name,...detail});
  p.toggle();assert.equal(p.data.open,true);
  p.properties.busy=true;p.choose(tap('index',0));assert.equal(commands.length,0);assert.equal(p.data.open,true);
  p.properties.busy=false;p.choose(tap('index',1));assert.equal(commands.length,1);assert.equal(commands[0].action,'history');assert.equal(p.data.open,false);
  p.toggle();p.close();assert.equal(p.data.open,false);
  p.toggle();p.pageLifetimes.hide.call(p);assert.equal(p.data.open,false);
});

test('三个页面的 Logo 菜单沿用原功能入口',()=>{
  const sop=harness('miniprogram/pages/sop/index.js').page;let back=0,privacy=0;
  sop.back=()=>back++;sop.showPrivacy=()=>privacy++;
  sop.menuCommand({detail:{action:'catalog'}});sop.menuCommand({detail:{action:'privacy'}});assert.equal(back,1);assert.equal(privacy,1);
  const ai=harness('miniprogram/pages/ai/index.js').page;let fresh=0,history=0;
  ai.newConversation=async()=>fresh++;ai.showHistory=async()=>history++;
  ai.menuCommand({detail:{action:'new'}});ai.menuCommand({detail:{action:'history'}});assert.equal(fresh,1);assert.equal(history,1);
  const account=harness('miniprogram/pages/account/index.js').page;let refresh=0;account.refresh=async()=>refresh++;
  account.menuCommand({detail:{action:'refresh'}});assert.equal(refresh,1);
});

test('小程序刷新服务器课程后可直接打开新发布案例',async()=>{
  const course=JSON.parse(readFileSync('miniprogram/data/course.json','utf8'));
  const added=structuredClone(course.lessons[0]);added.id=98765;added.name='服务器新发布案例';
  course.lessons.push(added);course.categories[0].lessonIds.push(added.id);
  const h=harness('miniprogram/pages/sop/index.js',{request:o=>{
    if(o.url.endsWith('/auth/login'))return o.success({statusCode:200,data:{token:'course-token',expiresAt:Date.now()+86400000,authMode:'mock',aiMode:'mock'}});
    o.success({statusCode:200,data:course});
  }});
  h.page.onLoad();await h.page.loadCourse();assert.equal(h.page.data.visibleCases[0].id,98765);
  h.page.openCase(tap('id',98765));assert.equal(h.page.data.lesson.name,'服务器新发布案例');assert.equal(h.page.data.shot.title,added.shots[0].title);
});


test('三个顶部按钮进入老师后台，密码失败不进入，成功清除密码且退出清除权限',async()=>{
 for(const name of ['sop','ai','account']){
  const h=harness('miniprogram/pages/'+name+'/index.js',{navigateTo:o=>h.events.push(['navigateTo',o.url])});
  assert.match(readFileSync('miniprogram/pages/'+name+'/index.wxml','utf8'),/bindtap="openTeacher"/);
  h.page.openTeacher();assert.equal(h.events.at(-1)[1],'/pages/teacher/index');
 }
 let accepted=false,logout=0;
 const h=harness('miniprogram/pages/teacher/index.js',{request:o=>{
  const path=new URL(o.url).pathname;let statusCode=200,data;
  if(path==='/auth/login')data={token:'user-session',expiresAt:Date.now()+86400000,authMode:'mock',aiMode:'mock'};
  else if(path==='/teacher/login'){
   if(!accepted){statusCode=403;data={error:'密码不正确'};}
   else data={teacherToken:'teacher-session',expiresAt:Date.now()+1800000};
  }else{
   assert.equal(o.header['X-Teacher-Token'],'teacher-session');assert.equal(o.header.Authorization,'Bearer user-session');
   if(path==='/teacher/logout'){logout++;data={ok:true};}
   else data={items:[],authMode:'mock'};
  }
  o.success({statusCode,data});
 }});
 const p=h.page;p.data.password='test-password';await p.unlock();assert.equal(p.data.locked,true);assert.match(p.data.error,/密码/);
 accepted=true;await p.unlock();assert.equal(p.data.locked,false);assert.equal(p.data.password,'');assert.equal(p.teacherToken,'teacher-session');
 assert.ok(![...h.storage.values()].includes('teacher-session'));
 await p.logout();assert.equal(logout,1);assert.equal(p.data.locked,true);assert.equal(p.teacherToken,'');
});
