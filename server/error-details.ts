// Only emit bounded error types/codes, never request URLs, credentials or bodies.
export function errorDetails(error: unknown): string {
  const seen = new Set<object>();
  const parts: string[] = [];
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value) || parts.length >= 12) return;
    seen.add(value);
    const item = value as { name?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
    const name = typeof item.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.name) ? item.name : 'Error';
    const code = typeof item.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(item.code) ? item.code : '';
    parts.push(code ? `${name}:${code}` : name);
    visit(item.cause, depth + 1);
    if (Array.isArray(item.errors)) for (const child of item.errors.slice(0, 8)) visit(child, depth + 1);
  }
  visit(error, 0);
  return parts.join(' > ') || 'UnknownError';
}
