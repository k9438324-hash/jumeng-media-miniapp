import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createAdmin } from './admin.js';
const config=loadConfig(),admin=createAdmin(config);
admin.server.listen(8788,'127.0.0.1',()=>{
  const link='http://127.0.0.1:8788/#key='+admin.secret;
  const target=resolve(dirname(config.dbPath),'打开老师后台.url');
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,'[InternetShortcut]\r\nURL='+link+'\r\n');
  console.log('老师后台已启动：http://127.0.0.1:8788（仅本机）');
  console.log('请双击 server/data/打开老师后台.url；快捷方式含本机访问口令，请勿分享。');
});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void admin.close().then(()=>process.exit(0));});
