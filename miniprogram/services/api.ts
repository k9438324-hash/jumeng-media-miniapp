import { config } from '../config';
let session: { token: string; expiresAt: number; authMode: string; aiMode: string } | undefined;
let loginFlight: Promise<void> | undefined;
export class ApiError extends Error { constructor(message: string, public status = 0) { super(message); } }
export function raw<T>(path: string, method: 'GET' | 'POST' | 'DELETE', data?: unknown, token?: string): Promise<T> {
  return new Promise((resolve, reject) => wx.request({
    url: config.apiBase + path, method, data: data as WechatMiniprogram.IAnyObject,
    header: token ? { Authorization: 'Bearer ' + token } : {},
    success(res) {
      const body = res.data as { error?: string };
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data as T);
      else reject(new ApiError(body?.error || '请求失败', res.statusCode));
    },
    fail() { reject(new ApiError('网络连接失败，请检查服务端地址或稍后重试')); },
  }));
}
async function login(): Promise<void> {
  let deviceId = wx.getStorageSync('jumeng:mockDevice');
  if (!deviceId) { deviceId = 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2); wx.setStorageSync('jumeng:mockDevice', deviceId); }
  const code = config.authMode === 'wechat' ? await new Promise<string>((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error('微信登录未取得 code')), fail: () => reject(new Error('微信登录失败')) })) : '';
  session = await raw('/auth/login', 'POST', config.authMode === 'mock' ? { deviceId } : { code });
}
export async function api<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', data?: unknown): Promise<T> {
  if (!session || session.expiresAt <= Date.now() + 30000) {
    if (!loginFlight) loginFlight = login().finally(() => { loginFlight = undefined; });
    await loginFlight;
  }
  try { return await raw<T>(path, method, data, session!.token); }
  catch (e) { if (e instanceof ApiError && e.status === 401) session = undefined; throw e; }
}
export function sessionLabel(): string {
  if (!session) return '正在连接服务端';
  return session.aiMode === 'mock' ? '模拟模式 · 未调用真实 AI' : (session.authMode === 'mock' ? '真实 AI · 开发模拟身份' : 'DeepSeek · 微信身份');
}
