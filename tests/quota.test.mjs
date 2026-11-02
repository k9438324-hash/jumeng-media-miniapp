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
