import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root=process.env.WECHAT_DEVTOOLS_PATH || 'D:/Tools/WeixinDevTools';
const bin=resolve(root,'resources/app.asar.unpacked/node_modules/wcc-exec');
const wcc=resolve(bin,'wcc.exe'),wcsc=resolve(bin,'wcsc.exe');
if(!existsSync(wcc)||!existsSync(wcsc))throw new Error('未找到工具附带的Windows模板编译器，请设置WECHAT_DEVTOOLS_PATH指向微信开发者工具安装目录');
const output=resolve('test-results/native');mkdirSync(output,{recursive:true});
for(const [exe,files,name] of [
  [wcc,['pages/sop/index.wxml','pages/ai/index.wxml','pages/account/index.wxml','components/brand-menu/index.wxml','custom-tab-bar/index.wxml'],'templates.js'],
  [wcsc,['app.wxss','pages/sop/index.wxss','pages/ai/index.wxss','pages/account/index.wxss','components/brand-menu/index.wxss','custom-tab-bar/index.wxss','styles/tokens.wxss'],'styles.css'],
]){
  try{execFileSync(exe,['-o',resolve(output,name),...files],{cwd:resolve('miniprogram'),stdio:'pipe',windowsHide:true});}
  catch(e){console.error(e.stderr?.toString()||e.stdout?.toString()||e.message);process.exit(1);}
}
console.log('官方随工具提供的WXML/WXSS编译器检查通过。此检查不代表IDE完整编译、播放器或手机验收。');
