import test from 'node:test';
import assert from 'node:assert/strict';
import { errorDetails } from '../dist/server/error-details.js';

test('网络异常日志包含fetch底层及并发连接错误码，不输出凭证或请求内容', () => {
  const tls = Object.assign(new Error('https://api.example.com/?secret=private-key'), {code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'});
  const timeout = Object.assign(new Error('token=private-key'), {code:'ETIMEDOUT'});
  const cause = new AggregateError([tls, timeout], 'private-key');
  const error = new TypeError('fetch failed', {cause});
  const details = errorDetails(error);
  assert.match(details, /TypeError > AggregateError/);
  assert.match(details, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
  assert.match(details, /ETIMEDOUT/);
  assert.doesNotMatch(details, /private-key|https|token|secret/);
  cause.errors.push(error);
  assert.equal(errorDetails(error), details);
});
