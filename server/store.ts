import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
export interface Context { lessonId: number; shotIndex: number }
export interface Message { role: 'system' | 'user' | 'assistant'; content: string }
export interface Conversation { id: string; owner: string; title: string; context: Context | null; messages: Message[]; updatedAt: number }
export interface Job { id: string; owner: string; conversationId: string; requestId: string; status: 'running' | 'completed' | 'stopped' | 'failed'; text: string; error: string; mode: string }
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function dayKey(): string { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10); }
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true }); this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversation_owner ON conversations(owner);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, conversationId TEXT NOT NULL, requestId TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(conversationId,requestId));
      CREATE TABLE IF NOT EXISTS usage (owner TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(owner,day));`);
    // 进程中断后不让旧任务永远停留在“生成中”。
    for (const row of this.db.prepare('SELECT data FROM jobs').all()) {
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
  begin(owner: string, conversationId: string, requestId: string, content: string, mode: string, limit: number): Job {
    const previous = this.findRequest(owner, conversationId, requestId); if (previous) return previous;
    const c = this.conversation(owner, conversationId);
    if (c.messages.length >= 60) throw new HttpError(409, '本对话已达 30 轮，请新建对话');
    const active = this.db.prepare('SELECT data FROM jobs WHERE owner=? AND conversationId=?').all(owner, conversationId).some(r=>JSON.parse(r.data as string).status === 'running');
    if (active) throw new HttpError(409, '当前对话正在生成，请先停止');
    const job: Job = { id: randomUUID(), owner, conversationId, requestId, status: 'running', text: '', error: '', mode };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const count = Number(this.db.prepare('SELECT count FROM usage WHERE owner=? AND day=?').get(owner, dayKey())?.count || 0);
      if (count >= limit) throw new HttpError(429, '今日调用额度已用完，请明天再试');
      this.db.prepare('INSERT INTO usage VALUES (?,?,1) ON CONFLICT(owner,day) DO UPDATE SET count=count+1').run(owner, dayKey());
      if (c.messages.at(-1)?.role === 'user') c.messages.pop(); // 失败/停止后重试替换未获回答的提问。
      c.messages.push({ role: 'user', content }); c.title = c.messages[0].content.slice(0,24); this.save(c);
      this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?)').run(job.id, owner, conversationId, requestId, JSON.stringify(job));
      this.db.exec('COMMIT'); return job;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close() { this.db.close(); }
}
