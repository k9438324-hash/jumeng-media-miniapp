import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './mini-harness.mjs';

test('回答格式：标题、强调和代码可读，模型HTML与图片不会作为节点执行', () => {
  const { exports: { messageNodes } } = harness('miniprogram/services/message-format.js');
  const nodes = messageNodes('### 现场问题\n先拍**开门碰柜子**。\n\n<img src="https://example.com/a" onerror="bad()">\n```\n原始代码\n```');
  assert.equal(nodes[0].name, 'h3');
  assert.equal(nodes[1].children[1].name, 'strong');
  assert.equal(nodes[2].children[0].type, 'text');
  assert.match(nodes[2].children[0].text, /<img/);
  assert.equal(nodes[3].name, 'pre');
  assert.equal(messageNodes('```\n未闭合流式代码')[0].children[0].text, '未闭合流式代码');
});

test('聊天：上滑后保持阅读位置，回到底部恢复跟随；需求入口聚焦到末尾', () => {
  const h = harness('miniprogram/pages/ai/index.js'), p = h.page;
  p.lastScrollTop = 900;
  p.messageScroll({ detail: { scrollTop: 600, scrollHeight: 1500 } });
  assert.equal(p.data.followOutput, false);
  p.setData({ scrollTarget: '' }); p.scrollToEnd();
  assert.equal(p.data.scrollTarget, '');
  p.latestMessages(); assert.equal(p.data.followOutput, true); assert.equal(p.data.scrollTarget, 'messages-end');
  p.example({ currentTarget: { dataset: { text: '帮我检查这段口播：' } } });
  assert.equal(p.data.inputFocused, true); assert.equal(p.data.inputCursor, p.data.input.length);
});

test('重新生成先说明扣次，取消不发送，确认沿用原回答方法', async () => {
  let confirm = false, sends = 0, content = '';
  const h = harness('miniprogram/pages/ai/index.js', { showModal: o => { content = o.content; o.success({ confirm }); } });
  const p = h.page;
  p.setData({ conversation: { id: 'c1', messages: [{ role: 'user', content: '原始提问' }, { role: 'assistant', content: '原回答', skill: 'hook' }] } });
  p.send = async () => { sends++; };
  await p.retryMessage({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(sends, 0); assert.match(content, /1 次/);
  confirm = true; await p.retryMessage({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(sends, 1); assert.equal(p.data.workflowModes[p.data.workflowIndex].id, 'hook'); assert.equal(p.data.input, '原始提问');
});

test('少量案例也能搜索，搜索不到可清空恢复，并保留原分类', () => {
  const h = harness('miniprogram/pages/sop/index.js'), p = h.page; p.onLoad();
  assert.equal(p.data.showSearch, true);
  const count = p.data.visibleCases.length, category = p.data.categoryId;
  p.search({ detail: { value: '一定不存在的案例关键词' } });
  assert.equal(p.data.visibleCases.length, 0);
  p.toggleSearch(); assert.equal(p.data.visibleCases.length, count); assert.equal(p.data.categoryId, category);
});

test('连续快速切镜时进度立即更新，旧播放器回调不覆盖最后一镜', () => {
  const h = harness('miniprogram/pages/sop/index.js'), p = h.page; p.onLoad();
  p.openCase({ currentTarget: { dataset: { id: 1 } } });
  const original = p.setData.bind(p), callbacks = [];
  p.setData = (patch, callback) => { original(patch); if (callback) callbacks.push(callback); };
  p.next(); p.next(); assert.equal(p.data.shotIndex, 2);
  callbacks.reverse().forEach(callback => callback());
  assert(p.data.videoSrc.endsWith(p.data.lesson.shots[2].clip));
});
