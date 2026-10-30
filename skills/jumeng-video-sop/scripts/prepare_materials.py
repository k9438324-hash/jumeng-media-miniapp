"""只读视频和 SRT，验证时间并抽取供 Agent 实际查看的图片。仅使用本机 FFmpeg。"""
import argparse
import hashlib
import json
import math
import re
import subprocess
from pathlib import Path


def tool(args):
    result = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise ValueError(f'{args[0]} 执行失败：{result.stderr[-800:]}')
    return result.stdout


def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def timestamp(text):
    match = re.fullmatch(r'(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})', text.strip())
    if not match:
        raise ValueError(f'SRT 时间格式无效：{text}')
    hours, minutes, seconds, millis = map(int, match.groups())
    if minutes >= 60 or seconds >= 60:
        raise ValueError('SRT 分钟和秒必须小于 60')
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def parse_srt(text, duration, offset=0):
    cues, ids = [], set()
    for block in re.split(r'\n\s*\n', text.replace('\r\n', '\n').strip()):
        lines = block.strip().splitlines()
        if len(lines) < 3 or not lines[0].strip().isdigit() or '-->' not in lines[1]:
            raise ValueError('SRT 每段须包含序号、起止时间和正文')
        number = int(lines[0].strip())
        if number < 1 or number in ids:
            raise ValueError('SRT 序号必须为不重复的正整数')
        ids.add(number)
        start, end = [timestamp(part.strip().split()[0]) + offset for part in lines[1].split('-->')]
        content = '\n'.join(lines[2:]).strip()
        if not content or not 0 <= start < end <= duration + 0.1:
            raise ValueError(f'字幕 {number} 为空或时间超出视频；请核对对应文件和偏移')
        if cues and start < cues[-1]['start']:
            raise ValueError('SRT 须按开始时间排序，不自动重排来源')
        cues.append({'id': number, 'start': round(start, 3), 'end': round(min(end, duration), 3), 'text': content})
    if not cues:
        raise ValueError('没有有效字幕')
    return cues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--srt', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--offset', type=float, default=0)
    parser.add_argument('--max-frames', type=int, default=30)
    args = parser.parse_args()
    if not args.video.is_file() or not args.srt.is_file():
        raise ValueError('视频或 SRT 不存在')
    if not math.isfinite(args.offset) or not 1 <= args.max_frames <= 100:
        raise ValueError('偏移必须为有限秒数，抽帧上限为 1—100')
    info = json.loads(tool(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(args.video)]))
    duration = float(info['format']['duration'])
    if not any(stream['codec_type'] == 'video' for stream in info['streams']) or not math.isfinite(duration) or duration <= 0:
        raise ValueError('文件没有有效视频轨道或时长')
    raw = args.srt.read_bytes()
    for encoding in ('utf-8-sig', 'gb18030'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError('字幕无法按 UTF-8 或 GB18030 解码')
    cues = parse_srt(text, duration, args.offset)
    if args.out.exists() and any(args.out.iterdir()):
        raise ValueError('输出目录非空，请换新目录，不覆盖已有任务')
    frames_dir = args.out / 'frames'
    frames_dir.mkdir(parents=True, exist_ok=True)
    count = min(len(cues), args.max_frames)
    indices = sorted({round(i * (len(cues) - 1) / max(count - 1, 1)) for i in range(count)})
    frames = []
    for index in indices:
        cue = cues[index]
        time = round((cue['start'] + cue['end']) / 2, 3)
        name = f'frames/frame-{index + 1:04d}.jpg'
        tool(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-ss', str(time), '-i', str(args.video), '-frames:v', '1', '-vf', 'scale=720:-2', str(args.out / name)])
        if not (args.out / name).is_file():
            raise ValueError(f'未能抽取 {time} 秒画面')
        frames.append({'file': name, 'time': time, 'cue': cue['id']})
    manifest = {'schemaVersion': 1, 'video': {'localPath': str(args.video.resolve()), 'sha256': sha(args.video), 'duration': duration}, 'subtitle': {'localPath': str(args.srt.resolve()), 'sha256': sha(args.srt), 'offset': args.offset}, 'cues': cues, 'frames': frames}
    (args.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'材料准备完成：{len(cues)} 条字幕、{len(frames)} 张待查看图片；这不代表已完成画面理解。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise SystemExit(str(error))
