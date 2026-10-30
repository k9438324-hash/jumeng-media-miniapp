"""验证照拍课程、时间与来源证据，可渲染手机阅读 Markdown；不调用模型。"""
import argparse
import json
import math
import re
from pathlib import Path

FIELDS = {'title': '这一镜让人明白什么', 'logic': '为什么这样拍', 'where': '站在哪里', 'frame': '手机拍什么', 'action': '一步一步做', 'say': '怎么说', 'stop': '什么时候停', 'check': '拍完怎么检查'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, label, limit=4000):
    require(isinstance(value, str) and 0 < len(value.strip()) <= limit, f'{label} 不能为空或超过 {limit} 字')


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate(data, manifest=None):
    require(isinstance(data, dict) and data.get('schemaVersion') == 1, '课程版本必须为 1')
    require(data.get('category') in ('measure', 'start', 'case', 'meet', 'inspect'), '分类无效')
    lesson = data.get('lesson')
    require(isinstance(lesson, dict) and lesson.get('id') == 0, '只允许新增草稿，lesson.id 必须为 0')
    for key in ('name', 'task', 'need', 'takeaway'):
        text(lesson.get(key), key, 100 if key == 'name' else 4000)
    duration = lesson.get('duration')
    require(number(duration) and duration > 0, '视频时长无效')
    shots, evidence = lesson.get('shots'), data.get('evidence')
    require(isinstance(shots, list) and 1 <= len(shots) <= 100, '需要 1—100 个镜头')
    require(isinstance(evidence, list) and len(evidence) == len(shots), '每镜必须有一项来源证据')

    def media(value, folder):
        require(isinstance(value, str) and (not value or re.fullmatch(folder + r'/[A-Za-z0-9_][\w.-]*', value, flags=re.ASCII)), '媒体必须使用安全的相对键')

    media(lesson.get('file'), 'videos')
    for index, (shot, proof) in enumerate(zip(shots, evidence), 1):
        require(isinstance(shot, dict) and isinstance(proof, dict), '镜头和证据必须是对象')
        for key in FIELDS:
            text(shot.get(key), f'第 {index} 镜 {key}')
        start, end, keep = [shot.get(key) for key in ('ref', 'end', 'keep')]
        require(all(number(v) for v in (start, end, keep)) and 0 <= start < end <= duration + 0.01 and abs(keep - (end-start)) < 0.02, f'第 {index} 镜时间不正确')
        if index > 1:
            require(start >= shots[index-2]['ref'], '照拍步骤应按原片开始时间排序')
        for key, folder in (('clip', 'clips'), ('clipPoster', 'clips'), ('image', 'assets')):
            media(shot.get(key), folder)
        require(proof.get('shot') == index, '证据编号与镜头不对应')
        require(isinstance(proof.get('cues'), list) and proof['cues'] and all(type(c) is int for c in proof['cues']), '必须列出支持本镜的字幕编号')
        require(isinstance(proof.get('frames'), list) and proof['frames'] and all(isinstance(f, str) for f in proof['frames']), '必须列出已查看的图片')
        text(proof.get('observed'), '画面观察')
        require(isinstance(proof.get('adaptation'), str), '照拍建议必须与原片观察分开')
        require(isinstance(proof.get('unverified'), list) and all(isinstance(v, str) and v.strip() for v in proof['unverified']), '未确认信息必须是文字数组')
        if manifest:
            require(abs(duration-manifest['video']['duration']) < 0.1, '课程时长与视频不一致')
            cues = {cue['id']: cue for cue in manifest['cues']}
            frames = {frame['file']: frame for frame in manifest['frames']}
            for cue_id in proof['cues']:
                require(cue_id in cues and cues[cue_id]['start'] < end and cues[cue_id]['end'] > start, '引用了不存在或不属于该段的字幕')
            for name in proof['frames']:
                require(name in frames and start <= frames[name]['time'] <= end, '引用了不存在或不属于该段的图片')
    return data


def render(data):
    lesson = data['lesson']
    lines = [f"# {lesson['name']}", '', '## 这次要拍明白什么', '', lesson['task'], '', '## 适合什么现场、先准备什么', '', lesson['need'], '', '## 整条视频为什么这样拍', '', lesson['takeaway'], '']
    for index, (shot, proof) in enumerate(zip(lesson['shots'], data['evidence']), 1):
        lines.extend([f"## 第 {index} 步：{shot['title']}", '', f"原片对照：{shot['ref']:g}—{shot['end']:g} 秒", ''])
        for key, label in FIELDS.items():
            if key != 'title':
                lines.extend([f'**{label}**', '', shot[key], ''])
    lines.extend(['## 老师核对记录', '', '下面用于核对来源；学员照拍时可先看上面的步骤。', '', '| 步骤 | 原片秒数 | 字幕编号 | 已查看图片 |', '| --- | --- | --- | --- |'])
    for index, (shot, proof) in enumerate(zip(lesson['shots'], data['evidence']), 1):
        lines.append(f"| {index} | {shot['ref']:g}—{shot['end']:g} | {', '.join(map(str, proof['cues']))} | {', '.join(proof['frames'])} |")
    lines.append('')
    for index, proof in enumerate(data['evidence'], 1):
        lines.extend([f'### 第 {index} 镜来源', '', '**原片实际看见的**', '', proof['observed'], ''])
        if proof['adaptation']:
            lines.extend(['**照拍时可以这样改**', '', proof['adaptation'], ''])
        if proof['unverified']:
            lines.extend(['**还需确认**', '', '\n'.join('- ' + item for item in proof['unverified']), ''])
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--render', type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig')) if args.manifest else None
    data = validate(json.loads(args.input.read_text(encoding='utf-8-sig')), manifest)
    if args.render:
        args.render.parent.mkdir(parents=True, exist_ok=True)
        with args.render.open('x', encoding='utf-8') as output:
            output.write(render(data))
    print('课程格式与引用检查通过；画面观察和新人可读性仍须人工核对。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise SystemExit(str(error))
