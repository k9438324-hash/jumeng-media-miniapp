// 复用工程的管理模型，默认仅校验；--write 新增草稿，--publish 必须与 --write 同时使用。
import {readFileSync,existsSync,realpathSync,statSync,mkdirSync,copyFileSync,unlinkSync,constants} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

function mainArgs(){
  const out={};
  for(let i=2;i<process.argv.length;i++){
    const key=process.argv[i];
    if(['--write','--publish'].includes(key))out[key]=true;
    else if(['--project','--input','--media','--db'].includes(key) && process.argv[i+1] && !process.argv[i+1].startsWith('--'))out[key]=process.argv[++i];
    else throw Error('未知参数或缺少值：'+key);
  }
  if(!out['--project'] || !out['--input'])throw Error('需要 --project 工程目录和 --input 课程包');
  if(out['--publish'] && !out['--write'])throw Error('--publish 必须与 --write 同时使用');
  return out;
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
let store;const created=[];
try{
  const args=mainArgs(),project=resolve(args['--project']),input=resolve(args['--input']);
  const checked=spawnSync(process.env.PYTHON || 'python',[fileURLToPath(new URL('./check_delivery.py',import.meta.url)),input],{encoding:'utf8',windowsHide:true});
  if(checked.error || checked.status!==0)throw Error('课程校验失败：'+(checked.error?.message || checked.stderr || checked.stdout));
  const data=JSON.parse(readFileSync(input,'utf8').replace(/^\uFEFF/,''));
  if(args['--publish'] && data.evidence.some(item=>item.unverified.length))throw Error('仍有未确认信息，只能导入草稿，不能发布');
  const files=new Set([data.lesson.file,...data.lesson.shots.flatMap(shot=>[shot.clip,shot.clipPoster,shot.image])].filter(Boolean));
  const mediaRoot=args['--media']?realpathSync(resolve(args['--media'])):null;
  const sources=[];
  for(const key of files){
    if(!mediaRoot)throw Error('课程含媒体，请提供 --media 目录');
    const target=realpathSync(resolve(mediaRoot,key));
    if(!target.startsWith(mediaRoot+sep) || !statSync(target).isFile())throw Error('媒体路径越界或不是文件');
    const bytes=readFileSync(target),digest=hash(bytes);
    const valid=key.endsWith('.mp4')?bytes.subarray(4,8).toString()==='ftyp':key.endsWith('.png')?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):/\.jpe?g$/.test(key) && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
    if(!valid || !data.mediaHashes || data.mediaHashes[key]!==digest)throw Error('媒体缺少完整性记录或文件已改变：'+key);
    sources.push({key,target,digest});
  }
  const {Store}=await import(pathToFileURL(resolve(project,'dist/server/store.js')).href);
  const {Content}=await import(pathToFileURL(resolve(project,'dist/server/content.js')).href);
  // 校验也在内存中运行发布规则，避免输出无法发布的“可用”课程。
  store=new Store(':memory:',false);let content=new Content(store.db);
  const validation=content.save(0,{category:data.category,lesson:data.lesson});content.publish(validation.id,true);store.close();store=null;
  if(!args['--write']){console.log(JSON.stringify({checked:true,written:false,shots:data.lesson.shots.length,media:sources.length}));}
  else{
    const db=resolve(project,args['--db'] || process.env.DB_PATH || 'server/data/jumeng.sqlite');
    const uploads=resolve(dirname(db),'uploads');
    // 先检查所有同名素材，任何冲突都不覆盖。
    for(const file of sources){const target=resolve(uploads,file.key);if(existsSync(target) && hash(readFileSync(target))!==file.digest)throw Error('已有媒体内容冲突，未覆盖：'+file.key);}
    store=new Store(db,false);content=new Content(store.db);
    store.db.exec('CREATE TABLE IF NOT EXISTS sop_imports (fingerprint TEXT PRIMARY KEY, lessonId INTEGER NOT NULL)');
    const fingerprint=hash(JSON.stringify(canonical(data)));
    store.db.exec('BEGIN IMMEDIATE');
    try{
      const previous=store.db.prepare('SELECT lessonId FROM sop_imports WHERE fingerprint=?').get(fingerprint);
      let id;
      if(previous)id=Number(previous.lessonId);
      else{
        for(const file of sources){const target=resolve(uploads,file.key);if(!existsSync(target)){mkdirSync(dirname(target),{recursive:true});copyFileSync(file.target,target,constants.COPYFILE_EXCL);created.push(target);}}
        id=content.save(0,{category:data.category,lesson:data.lesson}).id;
        store.db.prepare('INSERT INTO sop_imports VALUES (?,?)').run(fingerprint,id);
      }
      if(args['--publish'] && !previous)content.publish(id,true);
      store.db.exec('COMMIT');created.length=0;
      console.log(JSON.stringify({checked:true,written:true,id,reused:!!previous,published:content.list().find(item=>item.id===id)?.published || false}));
    }catch(error){store.db.exec('ROLLBACK');throw error;}
  }
}catch(error){for(const path of created)try{unlinkSync(path);}catch{}console.error(error.message);process.exitCode=1;}
finally{store?.close();}
