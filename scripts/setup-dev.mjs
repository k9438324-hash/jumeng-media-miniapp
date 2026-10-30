import { copyFileSync, constants } from 'node:fs';
try {
  copyFileSync('server/.env.example','server/.env',constants.COPYFILE_EXCL);
  console.log('已创建server/.env。请按机器环境配置MEDIA_ROOT；模拟聊天无需API凭证。');
} catch(e) {
  if(e.code!=='EEXIST') throw e;
  console.log('保留现有server/.env，不覆盖配置或密钥。');
}
try {
  copyFileSync('config/project.private.example.json','project.private.config.json',constants.COPYFILE_EXCL);
  console.log('已创建本机调试配置，允许127.0.0.1服务；此配置不提交Git，正式项目配置仍校验域名。');
} catch(e) {
  if(e.code!=='EEXIST') throw e;
  console.log('保留现有project.private.config.json。');
}
