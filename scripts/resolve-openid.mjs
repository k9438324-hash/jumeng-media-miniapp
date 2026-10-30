// 管理员本地开户辅助；不向客户端暴露AppSecret，不自动修改许可名单。
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const {WECHAT_APP_ID:appid,WECHAT_APP_SECRET:secret}=process.env;
if(!appid || !secret) throw new Error('请先在服务端环境变量配置WECHAT_APP_ID和WECHAT_APP_SECRET');
const rl=createInterface({input:stdin,output:stdout});
try{
  const code=(await rl.question('输入刚刚取得的wx.login code（仅在本地终端，不要发到聊天）：')).trim();
  if(!/^[\w-]{1,200}$/.test(code))throw new Error('code格式无效');
  const url=new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search=new URLSearchParams({appid,secret,js_code:code,grant_type:'authorization_code'}).toString();
  const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok || result.errcode || !result.openid)throw new Error('微信换码失败；请核对AppID/Secret，重新取得未使用的code');
  console.log('该学员OpenID：'+result.openid);
  console.log('管理员核实学员后，在服务端WECHAT_ALLOWED_OPENIDS追加此值并重启服务。没有自动开通。');
}finally{rl.close();}
