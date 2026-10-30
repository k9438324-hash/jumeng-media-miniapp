import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createApplication} from '../dist/server/app.js';
import {loadConfig} from '../dist/server/config.js';
import {hash} from '../dist/server/store.js';

test('小程序老师后台：密码、会话绑定、真实管理、退出、过期与错误次数限制',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'jumeng-teacher-'));
 const app=createApplication({...loadConfig({}),teacherPasswordHash:hash('test-teacher-pass'),dbPath:resolve(dir,'db.sqlite'),port:0},async()=>{throw Error('测试不应调用模型');});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.shutdown();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 async function request(path,method='GET',data,token='',teacher=''){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Teacher-Token':teacher},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:r.status,data:await r.json()};
 }
 const login=await request('/auth/login','POST',{deviceId:'teacher-device-A'}),other=await request('/auth/login','POST',{deviceId:'teacher-device-B'});
 const user=login.data.token,second=other.data.token;
 assert.equal((await request('/teacher/login','POST',{password:'test-teacher-pass'})).status,401);
 assert.equal((await request('/teacher/courses','GET',undefined,user)).status,401);
 assert.equal((await request('/teacher/login','POST',{password:'wrong'},user)).status,403);
 const auth=await request('/teacher/login','POST',{password:'test-teacher-pass'},user);
 assert.equal(auth.status,200);assert.match(auth.data.teacherToken,/^[a-f0-9]{64}$/);
 const token=auth.data.teacherToken;
 assert.equal((await request('/teacher/courses','GET',undefined,second,token)).status,401);
 assert.equal((await request('/teacher/courses','GET',undefined,user,token)).status,200);
 // 另一身份不能使用该令牌；原持有者仍能正常使用。
 const renewed=await request('/teacher/login','POST',{password:'test-teacher-pass'},user),admin=renewed.data.teacherToken;
 const list=await request('/teacher/courses','GET',undefined,user,admin);assert.equal(list.status,200);assert.equal(list.data.items.length,9);
 const lesson=structuredClone(list.data.items[0].lesson);lesson.name='小程序后台测试';
 const saved=await request('/teacher/courses','POST',{category:'measure',lesson},user,admin);assert.equal(saved.status,200);
 assert.equal((await request('/teacher/courses/'+saved.data.id+'/publish','POST',{},user,admin)).status,200);
 assert.ok((await request('/course','GET',undefined,user)).data.lessons.some(l=>l.name===lesson.name));
 const student=await request('/teacher/students','POST',{kind:'mock',identity:'teacher-device-B',label:'测试学员'},user,admin);
 assert.equal(student.status,200);
 assert.equal((await request('/teacher/students/'+student.data.owner+'/grant','POST',{days:1,quota:5,label:'测试权益'},user,admin)).status,200);
 assert.equal((await request('/account','GET',undefined,second)).data.remaining,5);
 assert.equal((await request('/teacher/logout','POST',{},user,admin)).status,200);
 assert.equal((await request('/teacher/students','GET',undefined,user,admin)).status,401);
 const fresh=(await request('/teacher/login','POST',{password:'test-teacher-pass'},user)).data.teacherToken;
 const now=Date.now;Date.now=()=>now()+31*60000;
 try{assert.equal((await request('/teacher/courses','GET',undefined,user,fresh)).status,401);}finally{Date.now=now;}
 for(let i=0;i<5;i++)assert.equal((await request('/teacher/login','POST',{password:'wrong'},user)).status,403);
 assert.equal((await request('/teacher/login','POST',{password:'test-teacher-pass'},second)).status,429);
});

test('未配置老师密码时关闭入口',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'jumeng-teacher-disabled-'));
 const app=createApplication({...loadConfig({}),dbPath:resolve(dir,'db.sqlite'),port:0});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await app.shutdown();rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const login=await (await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:'disabled-teacher-device'})})).json();
 const r=await fetch(base+'/teacher/login',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+login.token},body:JSON.stringify({password:'anything'})});assert.equal(r.status,503);
});
