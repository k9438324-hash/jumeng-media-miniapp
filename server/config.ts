import { resolve } from 'node:path';
export interface Config {
  host: string; port: number; authMode: 'mock' | 'wechat'; aiMode: 'mock' | 'deepseek';
  appId: string; appSecret: string; allowedOpenids: string[];
  deepseekKey: string; deepseekBase: string; deepseekModel: string;
  dailyLimit: number; dbPath: string; mediaRoot: string; mockDelay: number;
  upstreamTimeout: number;
}
export function loadConfig(env = process.env): Config {
  const authMode = env.AUTH_MODE || 'mock', aiMode = env.AI_MODE || 'mock';
  if (!['mock','wechat'].includes(authMode) || !['mock','deepseek'].includes(aiMode)) throw new Error('AUTH_MODE 或 AI_MODE 无效');
  const host = env.HOST || '127.0.0.1';
  if (authMode === 'mock' && !['127.0.0.1','::1','localhost'].includes(host)) throw new Error('模拟身份只允许监听本机回环地址');
  if (env.NODE_ENV === 'production' && (authMode !== 'wechat' || aiMode !== 'deepseek')) throw new Error('生产环境必须使用微信身份和真实 AI');
  const allowedOpenids = (env.WECHAT_ALLOWED_OPENIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (authMode === 'wechat' && (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET)) throw new Error('微信模式缺少 AppID、AppSecret；学员仍需许可名单或后台开通');
  if (aiMode === 'deepseek' && !env.DEEPSEEK_API_KEY) throw new Error('真实 AI 缺少服务端 DEEPSEEK_API_KEY，不会自动降级模拟');
  const deepseekBase = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  if (!deepseekBase.startsWith('https://')) throw new Error('DeepSeek 地址必须为 HTTPS');
  const dailyLimit = Number(env.DAILY_REQUEST_LIMIT || 30);
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('额度或端口无效');
  return { host, port, authMode: authMode as Config['authMode'], aiMode: aiMode as Config['aiMode'],
    appId: env.WECHAT_APP_ID || '', appSecret: env.WECHAT_APP_SECRET || '', allowedOpenids,
    deepseekKey: env.DEEPSEEK_API_KEY || '', deepseekBase, deepseekModel: env.DEEPSEEK_MODEL || 'deepseek-flash',
    dailyLimit, dbPath: resolve(env.DB_PATH || 'server/data/jumeng.sqlite'), mediaRoot: env.MEDIA_ROOT ? resolve(env.MEDIA_ROOT) : '',
    mockDelay: 100, upstreamTimeout: 90000 };
}
