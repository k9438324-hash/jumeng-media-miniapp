import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const sourcePath = resolve(process.argv[2] || '../output/pdf/源文件/厨房视频照拍手册/手机课程.json');
const root = resolve(process.argv[3] || '../output/pdf/厨房视频照拍手册');
const course = JSON.parse(readFileSync(sourcePath, 'utf8'));
const files = new Set();
for (const l of course.lessons) { files.add(l.file); for (const s of l.shots) for (const key of ['clip','clipPoster','image']) files.add(s[key]); }
const missing = [];
for (const file of files) {
  try { if (!statSync(resolve(root, file)).isFile()) missing.push(file); } catch { missing.push(file); }
}
const hashes = [];
for (const l of course.lessons.filter((l,i,a)=>a.findIndex(x=>x.file===l.file)===i)) {
  const actual = createHash('sha256').update(readFileSync(resolve(root,l.file))).digest('hex');
  let originalMatch = null;
  if (l.source) { try { originalMatch = createHash('sha256').update(readFileSync(l.source)).digest('hex') === actual; } catch {} }
  hashes.push({ file: l.file, actual, recordedMatch: l.sha256 ? actual === l.sha256 : null, originalMatch });
}
const result = { checkedAt: new Date().toISOString(), root, mediaReferences: files.size, missing, hashes, originalFilesModified: false, uploaded: false };
writeFileSync('docs/media-verification.json', JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if (missing.length || hashes.some(x=>x.recordedMatch === false || x.originalMatch === false)) process.exitCode=1;
