import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createApplication} from '../dist/server/app.js';
import {loadConfig} from '../dist/server/config.js';
import {Store,hash} from '../dist/server/store.js';
import {SkillLibrary} from '../dist/server/skill-library.js';
import {harness} from './mini-harness.mjs';

test('老师在线更新Skill：草稿隔离、发布即时生效、任务版本冻结、回滚、停用及计次',async t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'jumeng-skills-'));
  const seen=[];let release;
  const app=createApplication({...loadConfig({}),dbPath:resolve(dir,'db.sqlite'),teacherPasswordHash:hash('test-only-password')},async(messages,_cfg,_signal,onText)=>{
    seen.push(messages[0].content);if(seen.length===1)await new Promise(resolve=>{release=resolve;});onText('已按规则处理');
  });
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{release?.();await app.shutdown();rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.server.address().port;
  let user='',teacher='';
  async function req(path,method='GET',data,admin=false,identity=user){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+identity,...(admin?{'X-Teacher-Token':teacher}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
  user=(await req('/auth/login','POST',{deviceId:'skill-admin-device'})).data.token;
  app.store.grant(app.store.owner(user),30,100,'测试权益');
  assert.equal((await req('/skills','GET',undefined,false,'')).status,401);
  assert.equal((await req('/teacher/skills')).status,401);
  teacher=(await req('/teacher/login','POST',{password:'test-only-password'})).data.teacherToken;
  const second=(await req('/auth/login','POST',{deviceId:'skill-other-device'})).data.token;
  assert.equal((await req('/teacher/skills','GET',undefined,true,second)).status,401);
  const definition={label:'客户需求诊断',description:'整理业主需求与预算',keywords:['需求诊断'],starter:'帮我整理这个客户的需求：',instruction:'TEST_RULE_ONE：先问现场用途，再整理客户需求。',order:0};
  let managed=(await req('/teacher/skills','POST',definition,true)).data;
  assert(managed.id.startsWith('skill-'));const id=managed.id;
  assert(!(await req('/skills')).data.items.some(s=>s.id===id));
  const conversation=(await req('/conversations','POST',{})).data;
  const path='/conversations/'+conversation.id+'/generations';
  assert.equal((await req(path,'POST',{requestId:'skill-draft-test',content:'需求诊断',skill:id})).status,400);
  assert.equal((await req('/account')).data.membership.used,0);
  managed=(await req('/teacher/skills/'+id+'/publish','POST',{revision:managed.revision},true)).data;
  assert.equal(managed.version,1);
  const catalog=(await req('/skills')).data.items.find(s=>s.id===id);
  assert.equal(catalog.label,definition.label);assert.equal('instruction' in catalog,false);assert.equal('keywords' in catalog,false);
  const first=(await req(path,'POST',{requestId:'skill-first-test',content:'帮我需求诊断',skill:'auto'})).data;
  assert.equal(first.skill,id);assert.equal(first.skillVersion,1);assert.equal('skillSnapshot' in first,false);assert.match(seen[0],/TEST_RULE_ONE/);
  const oldRevision=managed.revision;
  managed=(await req('/teacher/skills','POST',{...managed.draft,revision:managed.revision,instruction:'TEST_RULE_TWO：先核对预算和房屋现状。'},true)).data;
  assert.equal((await req('/teacher/skills','POST',{...managed.draft,revision:oldRevision},true)).status,409);
  managed=(await req('/teacher/skills/'+id+'/publish','POST',{revision:managed.revision},true)).data;
  assert.equal(managed.version,2);
  release();
  async function settled(job){for(let i=0;i<50;i++){const result=(await req('/generations/'+job.id)).data;if(result.status!=='running')return result;await delay(10);}throw Error('generation timeout');}
  assert.equal((await settled(first)).skillVersion,1);
  const duplicate=(await req(path,'POST',{requestId:'skill-first-test',content:'改过的问题',skill:id})).data;
  assert.equal(duplicate.id,first.id);assert.equal(duplicate.skillVersion,1);
  const next=(await req(path,'POST',{requestId:'skill-next-test',content:'这是预算补充',skill:id})).data;await settled(next);
  assert.equal(next.skillVersion,2);assert.match(seen[1],/TEST_RULE_TWO/);assert.equal((await req('/account')).data.membership.used,2);
  const restored=(await req('/teacher/skills/'+id+'/restore','POST',{revision:managed.revision},true)).data;
  assert.match(restored.draft.instruction,/TEST_RULE_ONE/);assert.equal(restored.changed,true);
  assert.equal((await req('/skills')).data.items.find(s=>s.id===id).version,2);
  managed=(await req('/teacher/skills/'+id+'/publish','POST',{revision:restored.revision},true)).data;assert.equal(managed.version,3);
  // 重启/另一连接不会重新覆盖运营人员已发布的规则。
  const reopened=new Store(resolve(dir,'db.sqlite'),false),library=new SkillLibrary(reopened.db);
  assert.equal(library.select(id,'test').version,3);assert.match(library.select(id,'test').instruction,/TEST_RULE_ONE/);reopened.close();
  const history=(await req('/conversations/'+conversation.id)).data;
  assert.equal(history.messages[1].skillVersion,1);assert.equal(history.messages[3].skillVersion,2);
  assert.equal(history.messages[1].skillLabel,definition.label);
  await req('/teacher/skills/'+id+'/unpublish','POST',{revision:managed.revision},true);
  assert(!(await req('/skills')).data.items.some(s=>s.id===id));
  assert.equal((await req(path,'POST',{requestId:'skill-disabled-test',content:'问题',skill:id})).status,400);
  assert.equal((await req('/account')).data.membership.used,2);
  const defaults=(await req('/teacher/skills','GET',undefined,true)).data.items;
  const general=defaults.find(s=>s.id==='general');
  assert.equal((await req('/teacher/skills/general/unpublish','POST',{revision:general.revision},true)).status,400);
  for(const changed of [{keywords:'not-array'},{instruction:''},{id:'../escape'},{order:-1}])assert.equal((await req('/teacher/skills','POST',{...definition,...changed},true)).status,400);
});

test('客户菜单从服务端加载新增Skill，历史标签保留发布时名称，老师退出清空正文',async()=>{
  const custom={id:'skill-client-test',label:'新名称',description:'诊断真实需求',starter:'请描述客户需求：',version:2};
  const c={id:'catalog-conversation',messages:[{role:'user',content:'问题'},{role:'assistant',content:'回答',skill:custom.id,skillLabel:'发布时名称',skillVersion:1}],skillMode:custom.id,activeSkill:custom.id};
  const h=harness('miniprogram/pages/ai/index.js',{}, {
    [resolve('miniprogram/services/course.js')]:{course:{lessons:[],categories:[]},refreshCourse:async()=>{}},
    [resolve('miniprogram/services/api.js')]:{ApiError:class extends Error{},sessionLabel:()=> '模拟模式',async api(path){if(path==='/skills')return {items:[custom,{id:'general',label:'现场拍摄'}]};if(path==='/account')return {status:'inactive',membership:null,remaining:0,todayUsed:0,dailyLimit:30};return c;}},
  });
  await h.page.initialize();assert.equal(h.page.data.workflowModes[1].id,custom.id);assert.equal(h.page.data.workflowIndex,1);assert.equal(h.page.data.examples[0].text,custom.starter);assert.equal(h.page.data.messageSkills[1],'发布时名称');
  const teacher=harness('miniprogram/pages/teacher/index.js').page;teacher.newSkill();teacher.data.activeSkill.draft.instruction='私有规则正文';teacher.teacherToken='private-session';teacher.lock();assert.equal(teacher.data.activeSkill,null);assert.equal(teacher.data.skills.length,0);assert.equal(teacher.teacherToken,'');
});

test('老师保存成功但发布断网时保留草稿ID，重试不会重复新增Skill',async()=>{
  let creates=0,failPublish=true;
  const draft={id:'skill-save-retry',label:'测试技能',description:'',keywords:[],instruction:'先核对材料。',starter:'',order:10};
  const saved={id:draft.id,draft,revision:1,version:0,published:false,changed:false};
  const h=harness('miniprogram/pages/teacher/index.js',{}, {
    [resolve('miniprogram/services/api.js')]:{ApiError:class extends Error{},async api(path,method,data){
      if(path==='/teacher/skills'&&method==='POST'){if(!data.id)creates++;return saved;}
      if(path.endsWith('/publish')){if(failPublish){failPublish=false;throw new Error('网络中断');}return {...saved,version:1,published:true};}
      return {items:[],authMode:'mock'};
    }},
  });
  const p=h.page;p.setData({locked:false});p.newSkill();p.data.activeSkill.draft={...draft,id:''};
  async function submit(){p.saveSkill({currentTarget:{dataset:{publish:true}}});while(p.data.busy)await delay(1);}
  await submit();assert.equal(creates,1);assert.equal(p.data.activeSkill.id,draft.id);assert.match(p.data.error,/网络/);
  await submit();assert.equal(creates,1);assert.equal(p.data.activeSkill,null);assert.match(p.data.notice,/已发布/);
});
