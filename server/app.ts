import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { statSync, createReadStream, realpathSync, existsSync } from 'node:fs';
import { resolve, sep, dirname } from 'node:path';
import { Store, HttpError, hash, type Context, type Job, type Conversation } from './store.js';
import type { Config } from './config.js';
import { generate, prompt, type Provider } from './provider.js';
import { Content } from './content.js';
function publicConversation({ owner: _owner, ...c }: Conversation) { return c; }
function publicJob({ owner: _owner, requestId: _requestId, ...j }: Job) { return j; }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new HttpError(413, '请求过大'); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0; return data; }
  catch { throw new HttpError(400, 'JSON 格式错误'); }
}
function context(value: unknown, course: { lessons: { id:number; shots: unknown[] }[] }): Context | null {
  if (value == null) return null;
  const c = value as Context;
  const lesson = course.lessons.find(l => l.id === c.lessonId);
  if (!lesson || !Number.isInteger(c.shotIndex) || c.shotIndex < 0 || c.shotIndex >= lesson.shots.length) throw new HttpError(400, 'SOP 镜头不存在');
  return { lessonId: c.lessonId, shotIndex: c.shotIndex };
}
export function createApplication(config: Config, provider: Provider = generate) {
  const store = new Store(config.dbPath);
  const content = new Content(store.db);
  const running = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  const loginAttempts = new Map<string, { since: number; count: number }>();
  const send = (res: ServerResponse, code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
  async function run(job: Job) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('生成超时，请重试')), config.upstreamTimeout);
    const promise = (async () => {
      try {
        const c = store.conversation(job.owner, job.conversationId);
        const lesson = c.context ? content.course().lessons.find(l=>l.id === c.context!.lessonId) : undefined;
        const reference = lesson ? { lesson, currentShot: c.context!.shotIndex } : undefined;
        await provider(prompt(c, reference), config, controller.signal, delta => {
          if (controller.signal.aborted) return;
          job.text += delta;
          if (job.text.length > 30000) throw new Error('生成内容过长，请缩小问题范围');
          store.saveJob(job);
        });
        if (!job.text.trim()) throw new Error('AI 未返回文字，请重试');
        job.status = 'completed';
      } catch (e) {
        job.status = controller.signal.aborted && controller.signal.reason === 'user-stop' ? 'stopped' : 'failed';
        job.error = job.status === 'stopped' ? '' : (controller.signal.aborted ? '生成超时，请重试' : (e instanceof Error && /AI |生成内容/.test(e.message) ? e.message : '生成失败，请重试'));
      } finally {
        clearTimeout(timeout);
        if ((job.status === 'completed' || job.status === 'stopped') && job.text) {
          const c = store.conversation(job.owner, job.conversationId);
          c.messages.push({ role: 'assistant', content: job.text }); store.save(c);
        }
        store.saveJob(job); running.delete(job.id);
      }
    })();
    running.set(job.id, { controller, promise });
    await promise;
  }
  function media(req: IncomingMessage, res: ServerResponse, path: string) {
    const key = decodeURIComponent(path.slice('/media/'.length));
    const mediaFiles=new Set<string>();
    for (const l of content.course().lessons) {
      mediaFiles.add(l.file);
      for(const s of l.shots)for(const k of ['clip','clipPoster','image'])if(s[k])mediaFiles.add(String(s[k]));
    }
    if (!mediaFiles.has(key)) throw new HttpError(404, '媒体不存在');
    const uploads=resolve(dirname(config.dbPath),'uploads');
    const folder=existsSync(resolve(uploads,key))?uploads:config.mediaRoot;
    if(!folder || !existsSync(resolve(folder,key)))throw new HttpError(404,'媒体文件尚未配置');
    const root = realpathSync(folder), target = realpathSync(resolve(root, key));
    if (!target.startsWith(root + sep)) throw new HttpError(403, '媒体路径无效');
    const stat = statSync(target); if (!stat.isFile()) throw new HttpError(404, '媒体不存在');
    let start = 0, end = stat.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
      if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; } status = 206;
    }
    res.writeHead(status, { 'Content-Type': key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.png')?'image/png':'image/jpeg', 'Content-Length': end-start+1, 'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(target, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (path === '/health' && req.method === 'GET') return send(res, 200, { ok: true, authMode: config.authMode, aiMode: config.aiMode });
      // 只读媒体服务只供本地调试；正式媒体使用经授权配置的 HTTPS 地址。
      if (path.startsWith('/media/') && config.authMode === 'mock' && ['GET','HEAD'].includes(req.method || '')) return media(req, res, path);
      if (path === '/auth/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown';
        let rate = loginAttempts.get(ip);
        if (!rate || Date.now()-rate.since > 60000) { rate = { since: Date.now(), count: 0 }; loginAttempts.set(ip, rate); }
        if (++rate.count > 20) throw new HttpError(429, '登录过于频繁，请稍后重试');
        const data = await body(req); let owner: string;
        if (config.authMode === 'mock') {
          if (typeof data.deviceId !== 'string' || !/^[\w-]{8,100}$/.test(data.deviceId)) throw new HttpError(400, '模拟设备标识无效');
          owner = 'mock:' + hash(data.deviceId);
        } else {
          if (typeof data.code !== 'string' || !/^[\w-]{1,200}$/.test(data.code)) throw new HttpError(400, '微信登录 code 无效');
          const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
          url.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret, js_code: data.code, grant_type: 'authorization_code' }).toString();
          const result = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!result.ok) throw new HttpError(502, '微信身份服务不可用');
          const identity = await result.json() as { openid?: string; errcode?: number };
          if (!identity.openid || identity.errcode) throw new HttpError(401, '微信登录失败，请重新登录');
          owner = 'wx:' + hash(identity.openid);
          if (!store.allowed(owner,config.allowedOpenids)) throw new HttpError(403, '此微信账号未开通使用权限');
        }
        return send(res, 200, { ...store.session(owner), authMode: config.authMode, aiMode: config.aiMode });
      }
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const owner = store.owner(token);
      // 实时检查名单，已移除的学员不能继续用旧会话调用。
      if ((config.authMode === 'wechat' && !store.allowed(owner,config.allowedOpenids)) || store.db.prepare('SELECT enabled FROM students WHERE owner=?').get(owner)?.enabled===0) throw new HttpError(403, '使用权限已关闭');
      if (path === '/course' && req.method === 'GET') return send(res,200,content.course());
      if (path === '/account' && req.method === 'GET') return send(res, 200, store.account(owner,config.dailyLimit));
      if (path === '/conversations') {
        if (req.method === 'GET') return send(res, 200, { items: store.list(owner).map(c => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, context: c.context })) });
        if (req.method === 'POST') return send(res, 201, publicConversation(store.create(owner, context((await body(req)).context,content.course()))));
      }
      const conversationMatch = /^\/conversations\/([\w-]+)$/.exec(path);
      if (conversationMatch && req.method === 'GET') return send(res, 200, publicConversation(store.conversation(owner, conversationMatch[1])));
      const requestMatch = /^\/conversations\/([\w-]+)\/generations\/by-request\/([\w-]{8,100})$/.exec(path);
      if (requestMatch && req.method === 'GET') {
        store.conversation(owner, requestMatch[1]);
        const job = store.findRequest(owner, requestMatch[1], requestMatch[2]);
        if (!job) throw new HttpError(404, '生成任务不存在');
        return send(res, 200, publicJob(job));
      }
      const generationMatch = /^\/conversations\/([\w-]+)\/generations$/.exec(path);
      if (generationMatch && req.method === 'POST') {
        const data = await body(req);
        if (typeof data.content !== 'string' || !data.content.trim() || data.content.length > 4000) throw new HttpError(400, '请输入 1–4000 字文字');
        if (typeof data.requestId !== 'string' || !/^[\w-]{8,100}$/.test(data.requestId)) throw new HttpError(400, '请求标识无效');
        const old = store.findRequest(owner, generationMatch[1], data.requestId);
        const job = store.begin(owner, generationMatch[1], data.requestId, data.content.trim(), config.aiMode, config.dailyLimit);
        if (!old) void run(job);
        return send(res, 202, publicJob(job));
      }
      const jobMatch = /^\/generations\/([\w-]+)$/.exec(path);
      if (jobMatch) {
        let job = store.job(owner, jobMatch[1]);
        if (req.method === 'DELETE') {
          const active = running.get(job.id); active?.controller.abort('user-stop'); await active?.promise;
          job = store.job(owner, job.id);
          return send(res, 200, publicJob(job));
        }
        if (req.method === 'GET') return send(res, 200, publicJob(job));
      }
      throw new HttpError(404, '接口不存在');
    } catch (e) {
      if (res.headersSent) return res.destroy();
      send(res, e instanceof HttpError ? e.status : 500, { error: e instanceof HttpError ? e.message : '服务暂时不可用，请重试' });
    }
  });
  return { server, store, async shutdown() { for (const r of running.values()) r.controller.abort('user-stop'); await Promise.all([...running.values()].map(r=>r.promise)); await new Promise<void>(r=>server.close(()=>r())); store.close(); } };
}
