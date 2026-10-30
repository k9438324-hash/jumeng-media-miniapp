import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Config } from './config.js';
import { Store, hash, HttpError } from './store.js';
import { Content } from './content.js';

  async function body(req:IncomingMessage) {
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new HttpError(413,'内容过大');chunks.push(chunk);}
    try { const data=JSON.parse(Buffer.concat(chunks).toString());if(!data || Array.isArray(data) || typeof data!=='object')throw 0;return data as Record<string,unknown>; }
    catch {throw new HttpError(400,'内容格式错误');}
  }

export async function managementRequest(config:Config,store:Store,content:Content,req:IncomingMessage,url:URL) {
  const path=url.pathname;
      if(path==='/api/courses' && req.method==='GET')return ({items:content.list()});
      if(path==='/api/courses' && req.method==='POST') {const data=await body(req);return (content.save(Number(data.id)||0,data));}
      const publish=/^\/api\/courses\/(\d+)\/(publish|unpublish)$/.exec(path);
      if(publish && req.method==='POST'){content.publish(Number(publish[1]),publish[2]==='publish');return ({ok:true});}
      if(path==='/api/students' && req.method==='GET') {
        const owners=new Set<string>([
          ...store.db.prepare('SELECT owner FROM students UNION SELECT owner FROM memberships UNION SELECT owner FROM sessions').all().map(r=>String(r.owner)),
          ...config.allowedOpenids.map(id=>'wx:'+hash(id)),
        ]);
        return ({authMode:config.authMode,items:[...owners].map(owner=>{
          const row=store.db.prepare('SELECT label,enabled FROM students WHERE owner=?').get(owner);
          return {owner,label:row?.label || (owner.startsWith('mock:')?'本机测试学员':'未备注学员'),enabled:owner.startsWith('mock:')?(row?!!row.enabled:true):store.allowed(owner,config.allowedOpenids),...store.account(owner,config.dailyLimit),grants:store.db.prepare('SELECT at,days,quota,label FROM membership_grants WHERE owner=? ORDER BY id DESC LIMIT 20').all(owner)};
        })});
      }
      if(path==='/api/students' && req.method==='POST') {
        const data=await body(req), identity=String(data.identity || '').trim(),label=String(data.label || '').trim(),kind=data.kind;
        if(!identity || identity.length>200 || !label || label.length>60 || !['wechat','mock'].includes(String(kind)))throw new HttpError(400,'请填写学员备注、身份类型和标识');
        if(kind==='mock' && config.authMode!=='mock')throw new HttpError(400,'正式环境不新增模拟账号');
        const owner=(kind==='mock'?'mock:':'wx:')+hash(identity);
        store.db.prepare('INSERT INTO students VALUES (?,?,1) ON CONFLICT(owner) DO UPDATE SET label=excluded.label,enabled=1').run(owner,label);
        return ({owner});
      }
      const student=/^\/api\/students\/((?:wx|mock):[a-f0-9]{64})\/(grant|enabled)$/.exec(path);
      if(student && req.method==='POST') {
        const owner=student[1],data=await body(req);
        const known=store.db.prepare('SELECT owner FROM students WHERE owner=? UNION SELECT owner FROM sessions WHERE owner=? UNION SELECT owner FROM memberships WHERE owner=?').get(owner,owner,owner);
        if(!known && !config.allowedOpenids.some(id=>'wx:'+hash(id)===owner))throw new HttpError(404,'学员不存在');
        if(student[2]==='grant') {
          const membership=store.grant(owner,Number(data.days),Number(data.quota),String(data.label || '学员权益'));
          return (membership);
        }
        if(typeof data.enabled!=='boolean')throw new HttpError(400,'权限状态无效');
        store.db.prepare("INSERT INTO students VALUES (?,'学员',?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled").run(owner,Number(data.enabled));
        return ({ok:true});
      }
      if(path==='/api/upload' && req.method==='POST') {
        const kind=url.searchParams.get('kind');
        const formats:Record<string,{ext:string;folder:string}>={'video/mp4':{ext:'.mp4',folder:kind==='clips'?'clips':'videos'},'image/jpeg':{ext:'.jpg',folder:kind==='clips'?'clips':'assets'},'image/png':{ext:'.png',folder:kind==='clips'?'clips':'assets'}};
        const format=formats[req.headers['content-type'] || ''];
        if(!format)throw new HttpError(400,'仅支持 MP4、JPG、PNG');
        const key=format.folder+'/'+randomUUID()+format.ext,folder=resolve(dirname(config.dbPath),'uploads',format.folder);
        await mkdir(folder,{recursive:true});
        const target=resolve(dirname(config.dbPath),'uploads',key),temp=target+'.part';
        const file=await open(temp,'wx');let size=0,header=Buffer.alloc(0);
        try {
          for await(const chunk of req){size+=chunk.length;if(size>200*1024*1024)throw new HttpError(413,'单个文件最大 200 MB');if(header.length<12)header=Buffer.concat([header,chunk]).subarray(0,12);await file.writeFile(chunk);}
          const valid=format.ext==='.mp4'?header.subarray(4,8).toString()==='ftyp':format.ext==='.png'?header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):header[0]===255 && header[1]===216 && header[2]===255;
          if(!valid)throw new HttpError(400,'文件内容与格式不符');
          await file.close();await rename(temp,target);return ({key,size});
        } catch(e) {await file.close().catch(()=>{});await unlink(temp).catch(()=>{});throw e;}
      }
      throw new HttpError(404,'接口不存在');
}

export function createAdmin(config:Config, secret=randomBytes(32).toString('hex')) {
  const store=new Store(config.dbPath,false), content=new Content(store.db);
  const server=createServer(async(req,res)=>{
    const send=(code:number,data:unknown)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const host='127.0.0.1:'+String((server.address() as {port:number}).port);
      if(req.headers.host!==host)throw new HttpError(403,'仅允许本机地址访问');
      if(req.headers.origin && req.headers.origin!=='http://'+host)throw new HttpError(403,'不接受跨站请求');
      const url=new URL(req.url || '/','http://'+host),path=url.pathname;
      if(path==='/' && req.method==='GET') {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"});
        return res.end(readFileSync(new URL('../../admin/index.html',import.meta.url),'utf8'));
      }
      const token=(req.headers.authorization || '').replace(/^Bearer /,'');
      if(Buffer.byteLength(token)!==Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(token),Buffer.from(secret)))throw new HttpError(401,'请从本机后台快捷方式进入');
      return send(200,await managementRequest(config,store,content,req,url));
    } catch(e){send(e instanceof HttpError?e.status:400,{error:e instanceof Error?e.message:'操作失败'});}
  });
  return {server,secret,store,content,async close(){await new Promise<void>(r=>server.close(()=>r()));store.close();}};
}
