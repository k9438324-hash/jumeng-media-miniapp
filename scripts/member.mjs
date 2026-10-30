import { existsSync } from 'node:fs';
import { loadConfig } from '../dist/server/config.js';
import { Store, hash } from '../dist/server/store.js';

// 仅在可信服务器终端使用，不开放客户端管理接口。
const [action, identityType, identity, days, quota, label] = process.argv.slice(2);
if (!['show','grant'].includes(action) || !['--openid','--device'].includes(identityType) || !identity || (action === 'grant' && (!days || !quota || !label))) {
  throw new Error('用法：npm run member -- show|grant --openid|--device 标识 [天数 次数 套餐名称]');
}
const config = loadConfig();
if (!existsSync(config.dbPath)) throw new Error('数据库不存在，请先启动服务并核对 DB_PATH');
if (identityType === '--openid' && !config.allowedOpenids.includes(identity)) throw new Error('请先将该学员加入 WECHAT_ALLOWED_OPENIDS');
if (identityType === '--device' && config.authMode !== 'mock') throw new Error('模拟设备仅限本地开发模式');
const owner = (identityType === '--openid' ? 'wx:' : 'mock:') + hash(identity);
const store = new Store(config.dbPath, false);
try {
  if (action === 'grant') store.grant(owner,Number(days),Number(quota),label);
  console.log(JSON.stringify(store.account(owner,config.dailyLimit),null,2));
} finally { store.close(); }
