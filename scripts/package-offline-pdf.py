"""从当前课程数据生成手机竖屏 PDF 与 iPhone 离线 ZIP，不读取密钥或聊天记录。"""
import json
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/pdf/聚梦SOP离线阅读包'
OUT.mkdir(parents=True, exist_ok=True)
COURSE = json.loads((ROOT / 'miniprogram/data/course.json').read_text(encoding='utf-8'))
pdfmetrics.registerFont(TTFont('Song', 'C:/Windows/Fonts/simsun.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('Hei', 'C:/Windows/Fonts/simhei.ttf'))
W, H, M = 390, 780, 26
BG, INK, MUTED, LINE, ACCENT = [HexColor(c) for c in ['#F5F1E8', '#1C1B19', '#5E5A52', '#E4DED0', '#D9482B']]
PDF = OUT / '聚梦传媒-SOP手机阅读版.pdf'
C = canvas.Canvas(str(PDF), pagesize=(W,H), pageCompression=1)
C.setTitle('聚梦传媒｜SOP 手机离线阅读版')
C.setAuthor('聚梦传媒')
LABELS = {'measure':'量房','start':'开工','case':'案例','meet':'谈单','inspect':'巡检'}
LESSONS = []
for category in COURSE['categories']:
    for lesson in reversed(COURSE['lessons']):
        if lesson['id'] in category['lessonIds']:
            LESSONS.append((LABELS.get(category['id'], category['name']), lesson))
TOTAL = 1 + sum(1 + len(l['shots']) for _, l in LESSONS)
page_number = 0

def text(value, x, top, size=14, leading=22, color=INK, font='Hei', width=None):
    style = ParagraphStyle('p', fontName=font, fontSize=size, leading=leading,
                           textColor=color, wordWrap='CJK', splitLongWords=True)
    p = Paragraph(escape(str(value)).replace('\n', '<br/>'), style)
    _, height = p.wrap(width or W-M-x, H)
    if top-height < 47:
        raise ValueError(f'第 {page_number} 页内容超出底部：{value}')
    p.drawOn(C,x,top-height)
    return top-height

def line(y):
    C.setStrokeColor(LINE)
    C.setLineWidth(.6)
    C.line(M,y,W-M,y)

def start(key, label):
    global page_number
    page_number += 1
    C.setFillColor(BG)
    C.rect(0,0,W,H,fill=1,stroke=0)
    C.bookmarkPage(key)
    C.setFont('Hei',10)
    C.setFillColor(MUTED)
    C.drawString(M,H-25,'聚梦传媒 / '+label)
    line(H-38)
    C.drawString(M,24,'目录')
    C.linkRect('', 'contents', (M,12,M+60,38), relative=0, thickness=0)
    C.drawRightString(W-M,24,f'{page_number} / {TOTAL}')

start('contents','离线阅读版')
C.addOutlineEntry('目录','contents',level=0)
C.drawImage(str(ROOT/'miniprogram/assets/jumeng-avatar.png'),M,H-109,50,50,mask='auto')
y=text('把现场拍明白',M,H-127,27,36,font='Song')-12
y=text('先想明白为什么，再照着做。',M,y,14,22,color=MUTED)-12
y=text('点击下方案例进入；每页底部“目录”可返回。',M,y,12,19,color=MUTED)-21
for category, lesson in LESSONS:
    title=f'{category} / {lesson["name"]}'
    bottom=text(title,M,y,15,23,font='Song')
    C.linkRect('',f'lesson-{lesson["id"]}',(M,bottom-8,W-M,y+4),relative=0,thickness=0)
    y=bottom-13
    line(y)
    y-=13
text('离线文字版 · 不含参考视频、AI、登录和会员查询。\n内容版本：2026-10-30。',M,y-2,11,18,color=MUTED)
C.showPage()

for category, lesson in LESSONS:
    key=f'lesson-{lesson["id"]}'
    start(key,category)
    C.addOutlineEntry(category+' / '+lesson['name'],key,level=0)
    y=text(lesson['name'],M,H-65,24,33,font='Song')-22
    y=text('这条视频要说清楚什么',M,y,11,17,color=MUTED)-8
    y=text(lesson['takeaway'],M,y,15,24)-20
    y=text('准备什么',M,y,11,17,color=MUTED)-8
    y=text(lesson['need'],M,y,13,21)-22
    line(y)
    y-=20
    for index, shot in enumerate(lesson['shots']):
        top=y
        y=text(f'{index+1}  {shot["title"]}',M,y,14,22)-13
        C.linkRect('',f'{key}-shot-{index}',(M,y+4,W-M,top+5),relative=0,thickness=0)
    C.showPage()
    for index, shot in enumerate(lesson['shots']):
        shotkey=f'{key}-shot-{index}'
        start(shotkey,category)
        C.addOutlineEntry(shot['title'],shotkey,level=1)
        y=text(lesson['name'],M,H-58,11,17,color=MUTED)-12
        y=text(shot['title'],M,y,22,30,font='Song')-18
        if shot.get('logic'):
            y=text('为什么这样拍',M,y,11,17,color=ACCENT)-6
            y=text(shot['logic'],M,y,14,22)-16
        line(y)
        y-=16
        for label, field in [('站在哪里','where'),('手机对准哪里','frame'),('开始后做什么','action'),
                             ('IP说什么或问什么','say'),('什么时候停止','stop'),('拍够的标准','check')]:
            y=text(label,M,y,10.5,16,color=MUTED)-4
            y=text(shot[field],M,y,13,20)-12
        C.setFont('Hei',10)
        C.setFillColor(MUTED)
        C.drawString(M,47,f'参考镜头 {index+1} / {len(lesson["shots"])}')
        C.drawRightString(W-M,47,'返回本案例')
        C.linkRect('',key,(W-110,39,W-M,63),relative=0,thickness=0)
        if index+1 < len(lesson['shots']):
            C.linkRect('',f'{key}-shot-{index+1}',(W/2,12,W-M,38),relative=0,thickness=0)
        C.showPage()
C.save()
assert page_number == TOTAL
readme='''聚梦传媒 SOP 离线阅读包

给 iPhone 的打开方法
1. 收到 ZIP 后，选择“存储到文件”，存到“我的 iPhone”或 iCloud 云盘。
2. 打开苹果“文件”App，找到 ZIP，点一下解压。
3. 打开解压文件夹，点“聚梦传媒-SOP手机阅读版.pdf”。
4. 从第一页目录选择案例；每页底部“目录”返回总目录，“返回本案例”返回镜头目录。
5. 保存到本机后可断网阅读。此包不要求运行代码或安装开发者工具。

本包包含当前全部 SOP 文字、每镜为什么这样拍、具体站位与操作。
不含视频、AI、登录、会员查询；不会产生 API 费用。
这是一份 PDF 阅读版，不是可安装的微信小程序。
如当前 PDF 预览器不响应目录链接，可直接上下翻页，或查看 PDF 的书签/目录。
版本：2026-10-30。
'''
(OUT/'iPhone打开说明.txt').write_text(readme,encoding='utf-8-sig')
ZIP = OUT.parent/'聚梦传媒-SOP-iPhone离线阅读包.zip'
with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(OUT.iterdir()):
        if path.is_file(): z.write(path,arcname=OUT.name+'/'+path.name)
print(str(PDF))
print(str(ZIP))
print(f'pages={TOTAL}, cases={len(LESSONS)}, shots={sum(len(l["shots"]) for _,l in LESSONS)}')
