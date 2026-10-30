import { copyFileSync, constants } from 'node:fs';
try {
  copyFileSync('server/.env.example','server/.env',constants.COPYFILE_EXCL);
  console.log('已创建server/.env。请按机器环境配置MEDIA_ROOT；模拟聊天无需API凭证。');
} catch(e) {
  if(e.code!=='EEXIST') throw e;
  console.log('保留现有server/.env，不覆盖配置或密钥。');
}
