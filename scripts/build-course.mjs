import { readFileSync, writeFileSync } from 'node:fs';
// JSON是课程真源；微信运行时只加载编译生成的JS模块。
const course=JSON.parse(readFileSync('miniprogram/data/course.json','utf8'));
writeFileSync('miniprogram/data/course.ts','// 自动生成；请修改course.json后重新构建。\nconst course = '+JSON.stringify(course,null,2)+';\nexport default course;\n');
const font = readFileSync('miniprogram/assets/fonts/jumeng-serif-semibold.ttf').toString('base64');
writeFileSync('miniprogram/data/title-font.ts', '// 自动生成；字体来源与授权见 assets/fonts/README.md。\nexport default "data:font/ttf;base64,' + font + '";\n');
