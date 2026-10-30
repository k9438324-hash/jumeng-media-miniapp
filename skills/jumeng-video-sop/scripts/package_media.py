"""把已核对的课程另存为 H.264 MP4、逐镜片段和封面；原文件只读。"""
import argparse
import json
import hashlib
from pathlib import Path
from check_delivery import validate
from prepare_materials import sha, tool


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
    data = validate(json.loads(args.input.read_text(encoding='utf-8-sig')), manifest)
    source = Path(manifest['video']['localPath'])
    if not source.is_file() or sha(source) != manifest['video']['sha256']:
        raise ValueError('原视频已改变或不存在，请重新准备材料，不使用过期时间对照')
    if args.out.exists() and any(args.out.iterdir()):
        raise ValueError('输出目录非空，请换新目录')
    for folder in ('videos', 'clips'):
        (args.out / 'media' / folder).mkdir(parents=True, exist_ok=True)
    prefix = manifest['video']['sha256'][:16]
    lesson = data['lesson']
    settings = ['-map', '0:v:0', '-map', '0:a?', '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart']
    base = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-n']
    lesson['file'] = f'videos/v-{prefix}-720-v1.mp4'
    tool(base + ['-i', str(source)] + settings + [str(args.out / 'media' / lesson['file'])])
    for index, shot in enumerate(lesson['shots'], 1):
        segment = hashlib.sha256(f"{prefix}:{shot['ref']}:{shot['end']}:720-v1".encode()).hexdigest()[:16]
        shot['clip'] = f'clips/c-{segment}.mp4'
        shot['clipPoster'] = f'clips/c-{segment}.jpg'
        shot['image'] = ''
        tool(base + ['-ss', str(shot['ref']), '-i', str(source), '-t', str(shot['end']-shot['ref'])] + settings + [str(args.out / 'media' / shot['clip'])])
        tool(base + ['-i', str(args.out / 'media' / shot['clip']), '-frames:v', '1', str(args.out / 'media' / shot['clipPoster'])])
    files = [lesson['file']] + [shot[key] for shot in lesson['shots'] for key in ('clip', 'clipPoster')]
    data['mediaHashes'] = {key: sha(args.out / 'media' / key) for key in files}
    validate(data, manifest)
    (args.out / 'package.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'媒体包完成：1 条完整片、{len(lesson["shots"])} 条片段及封面。未上传、未改原片。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise SystemExit(str(error))
