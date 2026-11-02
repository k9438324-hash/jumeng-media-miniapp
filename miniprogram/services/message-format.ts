export interface RichNode { type?: 'text'; text?: string; name?: string; attrs?: Record<string, string>; children?: RichNode[] }
function inline(text: string): RichNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return parts.filter(Boolean).map(part => part.startsWith('**') && part.endsWith('**')
    ? { name: 'strong', children: [{ type: 'text', text: part.slice(2, -2) }] }
    : part.startsWith('`') && part.endsWith('`')
      ? { name: 'code', children: [{ type: 'text', text: part.slice(1, -1) }] }
      : { type: 'text', text: part });
}
// 仅转换明确支持的文本标记；不解析模型给出的HTML、链接或图片。
export function messageNodes(text: string): RichNode[] {
  const nodes: RichNode[] = [];
  let code: string[] | null = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) {
      if (code) { nodes.push({ name: 'pre', attrs: { style: 'white-space:pre-wrap;margin:16rpx 0;' }, children: [{ type: 'text', text: code.join('\n') }] }); code = null; }
      else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const quote = /^>\s?(.+)$/.exec(line);
    nodes.push({ name: heading ? 'h3' : 'p', attrs: { style: heading ? 'font-size:32rpx;font-weight:600;margin:24rpx 0 12rpx;' : 'margin:0 0 16rpx;white-space:pre-wrap;' }, children: inline(heading ? heading[1] : quote ? '“' + quote[1] + '”' : line) });
  }
  if (code) nodes.push({ name: 'pre', attrs: { style: 'white-space:pre-wrap;' }, children: [{ type: 'text', text: code.join('\n') }] });
  return nodes;
}
