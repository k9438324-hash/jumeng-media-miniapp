import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './mini-harness.mjs';

test('额度圆环使用真实比例，处理到期、零额度和每日上限', () => {
  const { exports: { quotaView } } = harness('miniprogram/services/account.js');
  const account = { membership: { quota: 100, used: 28 }, status: 'active', remaining: 72, dailyLimit: 30, todayUsed: 5 };
  let q = quotaView(account);
  assert.equal(q.percent, 72); assert.equal(q.todayRemaining, 25); assert.equal(q.dailyPercent, 83);
  q = quotaView({ ...account, remaining: 2 });
  assert.equal(q.todayRemaining, 2); assert.equal(q.dailyPercent, 6);
  q = quotaView({ ...account, todayUsed: 30 });
  assert.equal(q.percent, 72); assert.equal(q.dailyPercent, 0); assert.equal(q.todayRemaining, 0);
  for (const status of ['expired', 'inactive', 'exhausted']) {
    q = quotaView({ ...account, status });
    assert.equal(q.percent, 0); assert.equal(q.dailyPercent, 0); assert.equal(q.todayRemaining, 0);
  }
  q = quotaView({ ...account, membership: null, remaining: 0 });
  assert.equal(q.percent, 0);
});

test('AI 额度查询失败清空余额，迟到响应不覆盖新页面，圆环进入会员', async () => {
  const requests = [];
  // 使用模块注入避免登录与额外网络，单独验证页面生命周期。
  const { resolve } = await import('node:path');
  const p = harness('miniprogram/pages/ai/index.js', {}, {
    [resolve('miniprogram/services/api.js')]: { api: () => new Promise((ok, fail) => requests.push({ ok, fail })), sessionLabel: () => '', ApiError: class extends Error {} },
  });
  const account = { membership: { quota: 100 }, status: 'active', remaining: 72, todayUsed: 0, dailyLimit: 30 };
  const first = p.page.refreshQuota(); requests.shift().ok(account); await first;
  assert.equal(p.page.data.quota.percent, 72);
  const late = p.page.refreshQuota(); p.page.onHide(); requests.shift().ok(account); await late;
  assert.equal(p.page.data.quota, null);
  const failed = p.page.refreshQuota(); requests.shift().fail(new Error('断网')); await failed;
  assert.equal(p.page.data.quota, null);
  p.page.openAccount(); assert.equal(p.storage.get('jumeng:account:open'), true);
  assert.equal(p.events.at(-1)[1], '/pages/account/index');
});
