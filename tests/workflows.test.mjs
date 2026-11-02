import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { workflows } from '../dist/server/workflows.js';
import { Store } from '../dist/server/store.js';
import { SkillLibrary } from '../dist/server/skill-library.js';
import { harness } from './mini-harness.mjs';

test('自动分流优先处理请求，续接简短补充，客户端方法与服务端一致', () => {
  const store=new Store(':memory:');const library=new SkillLibrary(store.db);
  const selectWorkflow=(text,previous)=>library.select('auto',text,previous).id;
  try {
  assert.equal(selectWorkflow('帮我检查口播逻辑：“先写标题，再讲开头。”'), 'flow');
  assert.equal(selectWorkflow('这个选题客户会在意吗？'), 'value');
  assert.equal(selectWorkflow('帮我起标题：冰箱放不下'), 'title');
  assert.equal(selectWorkflow('已经拍完，别让我补拍', 'hook'), 'hook');
  assert.equal(selectWorkflow('手机站哪里，怎么拍？', 'title'), 'general');
  assert.equal(selectWorkflow('你好'), 'general');
  assert.throws(()=>library.select('toString',''),/未发布|停用/);assert.throws(()=>library.select(null,''),/无效/);
  const { exports: { workflowModes } } = harness('miniprogram/services/workflows.js');
  assert.deepEqual(Array.from(workflowModes, item => item.id).filter(id => id !== 'auto').sort(), Object.keys(workflows).sort());
  } finally {store.close();}
});

test('手动选择后断网重试保留原方法，历史恢复选择，旧对话默认自动', async () => {
  const calls=[];
  let reject=true;
  const conversation={id:'workflow-client',context:null,messages:[],updatedAt:0,skillMode:'title',activeSkill:'title'};
  const job={id:'job',conversationId:conversation.id,status:'completed',mode:'mock',text:'示例',skill:'title'};
  const { ApiError } = harness('miniprogram/services/api.js').exports;
  const h=harness('miniprogram/pages/ai/index.js',{}, {
    [resolve('miniprogram/services/api.js')]:{
      ApiError,sessionLabel:()=> '模拟模式',
      async api(path,method,data){
        if(path==='/account')return {status:'active',membership:{quota:10},remaining:9,todayUsed:1,dailyLimit:30};
        if(method==='POST'){
          calls.push({...data});if(reject){reject=false;throw new ApiError('网络连接失败');}return job;
        }
        return path.startsWith('/generations/')?job:conversation;
      }
    }
  });
  const p=h.page;p.setData({conversation,input:'写标题'});p.chooseWorkflow({detail:{value:'2'}});await p.send();
  assert.match(p.data.error,/网络/);assert.equal(calls[0].skill,'title');
  p.chooseWorkflow({detail:{value:'3'}});await p.retry();
  assert.equal(calls[1].skill,'title');assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(p.data.workflowIndex,2);
  assert.equal(p.data.activeWorkflow,'标题与封面');
  delete conversation.skillMode;delete conversation.activeSkill;await p.loadConversation(conversation.id);
  assert.equal(p.data.workflowIndex,0);assert.equal(p.data.activeWorkflow,'');
});
