import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { HttpError } from './store.js';
import { workflows, type WorkflowDefinition } from './workflows.js';

export interface PublishedSkill extends WorkflowDefinition { version: number }
export interface ManagedSkill { id: string; draft: WorkflowDefinition; revision: number; version: number; published: boolean; changed: boolean; publishedAt: number }
const defaults: [keyof typeof workflows, string, string[], string][] = [
  ['hook', '找到现场最值得先说的事', ['开头','开场','前几秒','留住观众','钩子'], '帮我优化这个视频开头：'],
  ['title', '让文字对上视频里的内容', ['标题','封面'], '帮我写标题与封面文案。视频内容是：'],
  ['flow', '看看哪里接不上、说不顺', ['逻辑','衔接','不顺','顺不顺','逐字稿','检查口播','检查这段口播'], '帮我检查这段口播的逻辑：'],
  ['value', '看看这件事吸引哪些客户', ['内容价值','选题','获客','在意','值不值得','有没有价值','流量分析','评估内容'], '帮我评估这个选题的内容价值：'],
  ['general', '结合SOP和现场条件调整拍法', ['怎么拍','拍法','站位','手机','机位','镜头怎么'], '我在现场，想问一下拍法：'],
];
export class SkillLibrary {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_skills (id TEXT PRIMARY KEY, draft TEXT NOT NULL, revision INTEGER NOT NULL, version INTEGER NOT NULL, published TEXT, publishedAt INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ai_skill_versions (id TEXT NOT NULL, version INTEGER NOT NULL, definition TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(id,version));`);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!Number(db.prepare('SELECT count(*) AS count FROM ai_skills').get()!.count)) {
        defaults.forEach(([id,description,keywords,starter],order) => {
          const data=JSON.stringify({id,...workflows[id],description,keywords,starter,order});
          db.prepare('INSERT INTO ai_skills VALUES (?,?,1,1,?,?)').run(id,data,data,Date.now());
          db.prepare('INSERT INTO ai_skill_versions VALUES (?,1,?,?)').run(id,data,Date.now());
        });
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  private row(id: string) {
    const row=this.db.prepare('SELECT * FROM ai_skills WHERE id=?').get(id);
    if (!row) throw new HttpError(404,'Skill不存在，请刷新列表');
    return row;
  }
  private view(row: Record<string, unknown>): ManagedSkill {
    return {id:String(row.id),draft:JSON.parse(String(row.draft)),revision:Number(row.revision),version:Number(row.version),published:!!row.published,changed:!!row.published && row.draft!==row.published,publishedAt:Number(row.publishedAt)};
  }
  list() { return this.db.prepare('SELECT * FROM ai_skills ORDER BY id').all().map(row=>this.view(row)).sort((a,b)=>a.draft.order-b.draft.order || a.id.localeCompare(b.id)); }
  published(): PublishedSkill[] {
    return this.db.prepare('SELECT published,version FROM ai_skills WHERE published IS NOT NULL').all().map(row=>({...JSON.parse(String(row.published)) as WorkflowDefinition,version:Number(row.version)})).sort((a,b)=>a.order-b.order || a.id.localeCompare(b.id));
  }
  catalog() { return this.published().map(({instruction:_instruction,keywords:_keywords,...item})=>item); }
  select(mode: unknown, text: string, previous?: string): PublishedSkill {
    const items=this.published();
    if (typeof mode!=='string' || mode.length>64) throw new HttpError(400,'处理方式无效，请重新选择');
    if (mode!=='auto') {
      const selected=items.find(item=>item.id===mode);
      if (!selected) throw new HttpError(400,'此 Skill 未发布或已停用，请重新打开聚梦AI同步列表');
      return selected;
    }
    const request=text.slice(0,500).toLowerCase(), intent=request.split(/[：:\n“「]/)[0];
    for (const scope of [intent,request]) {
      const matches=items.map(item=>({item,index:Math.min(...item.keywords.map(k=>scope.indexOf(k.toLowerCase())).filter(i=>i>=0))})).filter(match=>Number.isFinite(match.index)).sort((a,b)=>a.index-b.index || a.item.order-b.item.order);
      if (matches.length) return matches[0].item;
    }
    return items.find(item=>item.id===previous) || items.find(item=>item.id==='general')!;
  }
  save(value: Record<string, unknown>): ManagedSkill {
    const id=value.id===undefined || value.id==='' ? 'skill-'+randomUUID() : value.id;
    if (typeof id!=='string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id) || id==='auto') throw new HttpError(400,'Skill标识无效');
    const str=(key:string,max:number,required=false)=>{const raw=value[key];if(typeof raw!=='string' || raw.length>max || (required&&!raw.trim()))throw new HttpError(400,'请检查Skill名称、说明与正文的内容和长度');return raw.trim();};
    if (!Array.isArray(value.keywords) || value.keywords.length>24 || value.keywords.some(k=>typeof k!=='string' || !k.trim() || k.length>40)) throw new HttpError(400,'自动识别词最多24个，每个1–40字');
    const order=Number(value.order);if(!Number.isSafeInteger(order)||order<0||order>999)throw new HttpError(400,'排序请填写0–999的整数');
    const draft:WorkflowDefinition={id,label:str('label',24,true),description:str('description',120),keywords:[...new Set((value.keywords as string[]).map(k=>k.trim()))],instruction:str('instruction',16000,true),starter:str('starter',500),order};
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.db.prepare('SELECT * FROM ai_skills WHERE id=?').get(id);
      if (old) {
        if(value.revision!==Number(old.revision))throw new HttpError(409,'这份Skill已被更新，请刷新后重新编辑');
        if(old.draft!==JSON.stringify(draft))this.db.prepare('UPDATE ai_skills SET draft=?,revision=revision+1 WHERE id=?').run(JSON.stringify(draft),id);
      } else {
        if(value.id)throw new HttpError(404,'Skill不存在');
        if(Number(this.db.prepare('SELECT count(*) AS count FROM ai_skills').get()!.count)>=100)throw new HttpError(409,'最多管理100个Skill，请先整理现有技能');
        this.db.prepare('INSERT INTO ai_skills VALUES (?,?,1,0,NULL,0)').run(id,JSON.stringify(draft));
      }
      this.db.exec('COMMIT'); return this.view(this.row(id));
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  publish(id:string, revision:unknown, enabled=true) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row=this.row(id);
      if(revision!==Number(row.revision))throw new HttpError(409,'这份Skill已被更新，请刷新后再发布');
      if(!enabled && id==='general')throw new HttpError(400,'现场拍摄是默认处理方式，可编辑但不能停用');
      if(enabled && row.published!==row.draft) {
        const version=Number(row.version)+1,at=Date.now();
        this.db.prepare('INSERT INTO ai_skill_versions VALUES (?,?,?,?)').run(id,version,String(row.draft),at);
        this.db.prepare('UPDATE ai_skills SET published=draft,version=?,publishedAt=? WHERE id=?').run(version,at,id);
      } else if(!enabled)this.db.prepare('UPDATE ai_skills SET published=NULL WHERE id=?').run(id);
      this.db.exec('COMMIT');return this.view(this.row(id));
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  restore(id:string, revision:unknown) {
    const row=this.row(id);
    const previous=this.db.prepare('SELECT definition FROM ai_skill_versions WHERE id=? AND version<? ORDER BY version DESC LIMIT 1').get(id,Number(row.version));
    if(!previous)throw new HttpError(400,'还没有上一发布版可以恢复');
    return this.save({...JSON.parse(String(previous.definition)),revision});
  }
}
