import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { WorkflowId, WorkflowMode, WorkflowSnapshot } from './workflows.js';
export interface Context { lessonId: number; shotIndex: number }
export interface Message { role: 'system' | 'user' | 'assistant'; content: string; skill?: WorkflowId; skillLabel?: string; skillVersion?: number }
export interface Conversation { id: string; owner: string; title: string; context: Context | null; messages: Message[]; updatedAt: number; skillMode?: WorkflowMode; activeSkill?: WorkflowId }
export interface Job { id: string; owner: string; conversationId: string; requestId: string; status: 'running' | 'completed' | 'stopped' | 'failed'; text: string; error: string; mode: string; skill?: WorkflowId; skillLabel?: string; skillVersion?: number; skillSnapshot?: WorkflowSnapshot }
export interface Membership { label: string; startsAt: number; expiresAt: number; quota: number; used: number }
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function dayKey(): string { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10); }
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export class Store {
  db: DatabaseSync;
  constructor(path: string, recoverJobs = true) {
    mkdirSync(dirname(path), { recursive: true }); this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(owner);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, conversationId TEXT NOT NULL, requestId TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(conversationId,requestId));
      CREATE TABLE IF NOT EXISTS usage (owner TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(owner,day));
      CREATE TABLE IF NOT EXISTS memberships (owner TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS membership_grants (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, at INTEGER NOT NULL, days INTEGER NOT NULL, quota INTEGER NOT NULL, label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS consumption (jobId TEXT PRIMARY KEY, owner TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS consumption_owner ON consumption(owner,at);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS students (owner TEXT PRIMARY KEY, label TEXT NOT NULL, enabled INTEGER NOT NULL)');
    // 进程中断后不让旧任务永远停留在“生成中”。
    for (const row of recoverJobs ? this.db.prepare('SELECT data FROM jobs').all() : []) {
      const job = JSON.parse(row.data as string) as Job;
      if (job.status === 'running') { job.status = 'failed'; job.error = '服务已重启，请重试'; this.saveJob(job); }
    }
  }
  session(owner: string) {
    const token = randomUUID() + randomUUID(), expiresAt = Date.now() + 7 * 86400000;
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), owner, expiresAt);
    return { token, expiresAt };
  }
  owner(token: string): string {
    const row = this.db.prepare('SELECT owner FROM sessions WHERE token=? AND expires>?').get(hash(token), Date.now());
    if (!row) throw new HttpError(401, '登录已过期，请重试以重新登录');
    return row.owner as string;
  }
  list(owner: string): Conversation[] {
    return this.db.prepare('SELECT data FROM conversations WHERE owner=?').all(owner).map(r=>JSON.parse(r.data as string) as Conversation).sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  conversation(owner: string, id: string): Conversation {
    const row = this.db.prepare('SELECT data FROM conversations WHERE owner=? AND id=?').get(owner, id);
    if (!row) throw new HttpError(404, '对话不存在');
    return JSON.parse(row.data as string);
  }
  create(owner: string, context: Context | null): Conversation {
    if (this.list(owner).length >= 300) throw new HttpError(409, '当前对话数量已达上限');
    const c: Conversation = { id: randomUUID(), owner, title: '新对话', context, messages: [], updatedAt: Date.now() };
    this.db.prepare('INSERT INTO conversations VALUES (?,?,?)').run(c.id, owner, JSON.stringify(c)); return c;
  }
  save(c: Conversation) { c.updatedAt = Date.now(); this.db.prepare('UPDATE conversations SET data=? WHERE id=? AND owner=?').run(JSON.stringify(c), c.id, c.owner); }
  saveJob(job: Job) { this.db.prepare('UPDATE jobs SET data=? WHERE id=? AND owner=?').run(JSON.stringify(job), job.id, job.owner); }
  job(owner: string, id: string): Job {
    const row = this.db.prepare('SELECT data FROM jobs WHERE owner=? AND id=?').get(owner, id);
    if (!row) throw new HttpError(404, '生成任务不存在'); return JSON.parse(row.data as string);
  }
  findRequest(owner: string, conversationId: string, requestId: string): Job | undefined {
    const row = this.db.prepare('SELECT data FROM jobs WHERE owner=? AND conversationId=? AND requestId=?').get(owner, conversationId, requestId);
    return row ? JSON.parse(row.data as string) : undefined;
  }
  membership(owner: string): Membership | null {
    const row = this.db.prepare('SELECT data FROM memberships WHERE owner=?').get(owner);
    return row ? JSON.parse(row.data as string) : null;
  }
  allowed(owner:string, configured:string[]) {
    // 默认放行：新学员可直接使用试用额度；仅当 students 表明确 enabled=0 时才拉黑。
    const student=this.db.prepare('SELECT enabled FROM students WHERE owner=?').get(owner);
    if (student) return !!student.enabled;
    return true;
  }
  // 学员首次使用时自动发放试用额度（默认 100 次）。已有会员或已发过试用则跳过。
  ensureTrial(owner: string, trialQuota: number, label = '试用额度') {
    if (!Number.isSafeInteger(trialQuota) || trialQuota < 0) throw new Error('试用额度无效');
    const existing = this.membership(owner);
    if (existing) return existing; // 已开通会员或已发过试用，不再重复发放
    const now = Date.now();
    const next: Membership = { label, startsAt: now, expiresAt: now + 3650 * 86400000, quota: trialQuota, used: 0 };
    this.db.prepare('INSERT INTO memberships VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(owner, JSON.stringify(next));
    this.db.prepare('INSERT INTO membership_grants(owner,at,days,quota,label) VALUES (?,?,?,?,?)').run(owner, now, 0, trialQuota, label);
    return next;
  }
  grant(owner: string, days: number, quota: number, label: string) {
    if (!owner || !Number.isSafeInteger(days) || days < 0 || days > 3650 || !Number.isSafeInteger(quota) || quota < 0 || quota > 1000000 || days+quota===0 || !label.trim() || label.length > 60) throw new Error('开通参数无效');
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.membership(owner), active = old && old.expiresAt > now;
      if (!active && days===0) throw new Error('会员未开通或已到期，请先设置开通天数');
      const next: Membership = { label: label.trim(), startsAt: active ? old.startsAt : now,
        expiresAt: (active ? old.expiresAt : now) + days * 86400000,
        quota: (active ? old.quota : 0) + quota, used: active ? old.used : 0 };
      this.db.prepare('INSERT INTO memberships VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(owner, JSON.stringify(next));
      this.db.prepare('INSERT INTO membership_grants(owner,at,days,quota,label) VALUES (?,?,?,?,?)').run(owner,now,days,quota,next.label);
      this.db.exec('COMMIT'); return next;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  account(owner: string, dailyLimit: number) {
    const membership = this.membership(owner), now = Date.now();
    const status = !membership ? 'inactive' : membership.expiresAt <= now ? 'expired' : membership.used >= membership.quota ? 'exhausted' : 'active';
    const todayUsed = Number(this.db.prepare('SELECT count FROM usage WHERE owner=? AND day=?').get(owner,dayKey())?.count || 0);
    const records = this.db.prepare('SELECT jobId,at FROM consumption WHERE owner=? ORDER BY at DESC,jobId DESC LIMIT 50').all(owner).map(row => {
      const job = this.job(owner,row.jobId as string);
      return { id: job.id, at: Number(row.at), status: job.status, mode: job.mode, charged: 1 };
    });
    return { membership, status, remaining: membership ? Math.max(0,membership.quota-membership.used) : 0, todayUsed, dailyLimit, records };
  }
  begin(owner: string, conversationId: string, requestId: string, content: string, mode: string, limit: number, skill?: WorkflowId, skillMode?: WorkflowMode, skillSnapshot?: WorkflowSnapshot): Job {
    const previous = this.findRequest(owner, conversationId, requestId); if (previous) return previous;
    const c = this.conversation(owner, conversationId);
    if (c.messages.length >= 60) throw new HttpError(409, '本对话已达 30 轮，请新建对话');
    const active = this.db.prepare('SELECT data FROM jobs WHERE owner=? AND conversationId=?').all(owner, conversationId).some(r=>JSON.parse(r.data as string).status === 'running');
    if (active) throw new HttpError(409, '当前对话正在生成，请先停止');
    const job: Job = { id: randomUUID(), owner, conversationId, requestId, status: 'running', text: '', error: '', mode, ...(skill ? { skill } : {}), ...(skillSnapshot ? { skillSnapshot,skillLabel:skillSnapshot.label,skillVersion:skillSnapshot.version } : {}) };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const membership = this.membership(owner);
      if (!membership) throw new HttpError(403, '尚未开通使用权限，请联系老师开通');
      if (membership.expiresAt <= Date.now()) throw new HttpError(403, '使用期限已到，请联系老师续期');
      if (membership.used >= membership.quota) throw new HttpError(429, '试用额度已用完，请联系老师开通正式权限');
      const count = Number(this.db.prepare('SELECT count FROM usage WHERE owner=? AND day=?').get(owner, dayKey())?.count || 0);
      if (count >= limit) throw new HttpError(429, '今日调用额度已用完，请明天再试');
      this.db.prepare('INSERT INTO usage VALUES (?,?,1) ON CONFLICT(owner,day) DO UPDATE SET count=count+1').run(owner, dayKey());
      if (c.messages.at(-1)?.role === 'user') c.messages.pop(); // 失败/停止后重试替换未获回答的提问。
      if (skill) { c.activeSkill = skill; c.skillMode = skillMode || 'auto'; }
      c.messages.push({ role: 'user', content }); c.title = c.messages[0].content.slice(0,24); this.save(c);
      this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?)').run(job.id, owner, conversationId, requestId, JSON.stringify(job));
      membership.used++;
      this.db.prepare('UPDATE memberships SET data=? WHERE owner=?').run(JSON.stringify(membership),owner);
      this.db.prepare('INSERT INTO consumption VALUES (?,?,?)').run(job.id,owner,Date.now());
      this.db.exec('COMMIT'); return job;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
