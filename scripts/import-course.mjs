import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const source = resolve(process.argv[2] || '../output/pdf/源文件/厨房视频照拍手册/手机课程.json');
const bytes = readFileSync(source);
const input = JSON.parse(bytes);
const clean = s => typeof s === 'string' ? s.replaceAll('聚美传媒', '聚梦传媒') : s;
const lessons = input.lessons.map(l => ({
  id: l.id, name: clean(l.name), task: clean(l.task), need: clean(l.need), takeaway: clean(l.takeaway),
  file: l.file, duration: l.duration,
  shots: l.shots.map(s => Object.fromEntries(['title','logic','where','frame','action','say','stop','check','ref','end','keep','clip','clipPoster','image'].map(k => [k, clean(s[k])])))
}));
const course = { categories: input.categories, lessons };
mkdirSync('miniprogram/data', { recursive: true });
writeFileSync('miniprogram/data/course.json', JSON.stringify(course, null, 2) + '\n');
mkdirSync('docs', { recursive: true });
writeFileSync('docs/course-provenance.json', JSON.stringify({ source, sha256: createHash('sha256').update(bytes).digest('hex'), categories: course.categories.length, lessons: lessons.length, shots: lessons.reduce((n,l)=>n+l.shots.length,0), uniqueVideos: new Set(lessons.map(l=>l.file)).size, reusedVideo: '案例 1 与案例 8 共用完整视频；镜头脚本不同。', omitted: ['source (本地原片绝对路径)', 'segments (非照拍镜头)', 'sha256 (留在来源报告)'] }, null, 2) + '\n');
console.log('已导入', lessons.length, '案例；未复制、修改或上传媒体。');
