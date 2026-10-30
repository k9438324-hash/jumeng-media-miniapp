import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './store.js';
export interface ManagedLesson { id: number; name: string; task: string; need: string; takeaway: string; file: string; duration: number; shots: Record<string, string | number>[] }
const seed = JSON.parse(readFileSync(new URL('../../miniprogram/data/course.json', import.meta.url),'utf8')) as { categories: { id: string; name: string; desc: string; lessonIds: number[]; primary: number }[]; lessons: ManagedLesson[] };
const names: Record<string,string> = { measure:'量房', start:'开工', case:'案例', meet:'谈单', inspect:'巡检' };
export class Content {
  constructor(private db: DatabaseSync) {
    db.exec('CREATE TABLE IF NOT EXISTS course_items (id INTEGER PRIMARY KEY, category TEXT NOT NULL, draft TEXT NOT NULL, published TEXT, publishedAt INTEGER NOT NULL DEFAULT 0)');
    // 仅空库初始化一次，已下架的课程不会因重启恢复发布。
    db.exec('CREATE TABLE IF NOT EXISTS content_meta (key TEXT PRIMARY KEY)');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare("SELECT key FROM content_meta WHERE key='seeded'").get()) {
        seed.lessons.forEach((lesson,i)=>{
          const category=seed.categories.find(c=>c.lessonIds.includes(lesson.id))!;
          const data=JSON.stringify(lesson);
          db.prepare('INSERT INTO course_items VALUES (?,?,?,?,?)').run(lesson.id,category.id,data,JSON.stringify({ category:category.id,lesson }),i+1);
        });
        db.prepare("INSERT INTO content_meta VALUES ('seeded')").run();
      }
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  list() {
    return this.db.prepare('SELECT * FROM course_items ORDER BY id DESC').all().map(r=>({id:Number(r.id),category:r.category,lesson:JSON.parse(r.draft as string) as ManagedLesson,published:!!r.published,changed:!!r.published && JSON.stringify(JSON.parse(r.published as string))!==JSON.stringify({category:r.category,lesson:JSON.parse(r.draft as string)}),publishedAt:Number(r.publishedAt)}));
  }
  course() {
    const rows=this.db.prepare('SELECT published FROM course_items WHERE published IS NOT NULL ORDER BY publishedAt,id').all().map(r=>JSON.parse(r.published as string) as {category:string;lesson:ManagedLesson});
    return { categories:seed.categories.map(c=>({...c,name:names[c.id],lessonIds:rows.filter(r=>r.category===c.id).map(r=>r.lesson.id),primary:rows.find(r=>r.category===c.id)?.lesson.id || 0})), lessons:rows.map(r=>r.lesson) };
  }
  save(id: number, value: Record<string,unknown>) {
    const category=String(value.category || '');
    if (!seed.categories.some(c=>c.id===category)) throw new HttpError(400,'请选择有效分类');
    const raw=value.lesson as ManagedLesson;
    if (!raw || typeof raw!=='object' || !Array.isArray(raw.shots) || raw.shots.length<1 || raw.shots.length>100) throw new HttpError(400,'每条 SOP 需要 1–100 个镜头');
    const str=(v:unknown,max=4000)=>{ if(typeof v!=='string' || v.length>max)throw new HttpError(400,'文字格式或长度不正确');return v.trim(); };
    const path=(v:unknown,kind:string)=>{const s=str(v,200);if(s && !new RegExp('^'+kind+'/[\\w.-]+$').test(s))throw new HttpError(400,'媒体路径无效，请通过上传按钮选择文件');return s;};
    const lesson: ManagedLesson={id,name:str(raw.name,100),task:str(raw.task),need:str(raw.need),takeaway:str(raw.takeaway),file:path(raw.file,'videos'),duration:Number(raw.duration)||0,shots:raw.shots.map(s=>{
      const out:Record<string,string|number>={};
      for(const k of ['title','logic','where','frame','action','say','stop','check'])out[k]=str(s[k] || '');
      if(!out.title)throw new HttpError(400,'请填写镜头标题');
      for(const k of ['ref','end','keep']) {const n=Number(s[k])||0;if(n<0 || !Number.isFinite(n))throw new HttpError(400,'镜头时间无效');out[k]=n;}
      out.clip=path(s.clip || '','clips');out.clipPoster=path(s.clipPoster || '','clips');out.image=path(s.image || '','assets');return out;
    })};
    if(!lesson.name || lesson.duration<0 || !Number.isFinite(lesson.duration))throw new HttpError(400,'请填写名称并检查视频时长');
    if(id) {
      const result=this.db.prepare('UPDATE course_items SET category=?,draft=? WHERE id=?').run(category,JSON.stringify(lesson),id);
      if(!result.changes)throw new HttpError(404,'SOP 不存在');
    } else {
      const result=this.db.prepare('INSERT INTO course_items(category,draft) VALUES (?,?)').run(category,'{}');
      lesson.id=Number(result.lastInsertRowid);
      this.db.prepare('UPDATE course_items SET draft=? WHERE id=?').run(JSON.stringify(lesson),lesson.id);
    }
    return lesson;
  }
  publish(id:number,active:boolean) {
    const row=this.db.prepare('SELECT category,draft FROM course_items WHERE id=?').get(id);
    if(!row)throw new HttpError(404,'SOP 不存在');
    const lesson=JSON.parse(row.draft as string) as ManagedLesson;
    if(active && (!lesson.task || !lesson.takeaway || lesson.shots.some(s=>['logic','where','frame','action','say','stop','check'].some(k=>!String(s[k] || '').trim()))))throw new HttpError(400,'发布前请补齐拍摄目标、整条思路和每镜的说明');
    this.db.prepare('UPDATE course_items SET published=?,publishedAt=? WHERE id=?').run(active?JSON.stringify({category:row.category,lesson}):null,Date.now(),id);
  }
}
