"""用 Google Fonts NotoSerifSC 可变字体重新生成标题子集：python scripts/subset-title-font.py 原字体.ttf"""
import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

root = Path(__file__).resolve().parent.parent
course = json.loads((root / 'miniprogram/data/course.json').read_text(encoding='utf-8'))
text = '聚梦传媒对标SOPAI把现场说清楚会员与使用会员与使用记录历史对话第镜0123456789 /量房开工案例谈单巡检'
for lesson in course['lessons']:
    text += lesson['name']
    text += ''.join(shot['title'] for shot in lesson['shots'])
font = instantiateVariableFont(TTFont(sys.argv[1]), {'wght': 600}, inplace=True)
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
for record in font['name'].names:
    if record.nameID in [1, 4, 6]:
        name = 'JumengSerifSubset' if record.nameID == 6 else 'Jumeng Serif Subset'
        record.string = name.encode(record.getEncoding())
output = root / 'miniprogram/assets/fonts'
output.mkdir(exist_ok=True)
font.save(output / 'jumeng-serif-semibold.ttf')
(output / 'characters.txt').write_text(''.join(sorted(set(text))), encoding='utf-8')
print('标题子集已更新；请继续 npm run build')
