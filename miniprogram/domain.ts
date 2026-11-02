export interface Category { id: string; name: string; desc: string; lessonIds: number[]; primary: number }
export interface Shot {
  title: string; where: string; frame: string; action: string; say: string;
  logic?: string;
  stop: string; check: string; ref: number; end: number; keep: number;
  clip: string; clipPoster: string; image: string;
}
export interface Lesson { id: number; name: string; task: string; need: string; takeaway: string; file: string; duration: number; shots: Shot[] }
export interface Context { lessonId: number; shotIndex: number }
export type WorkflowId = string;
export type WorkflowMode = string;
export interface Message { role: 'user' | 'assistant'; content: string; skill?: WorkflowId; skillLabel?: string; skillVersion?: number }
export interface Conversation { id: string; title: string; context: Context | null; messages: Message[]; updatedAt: number; skillMode?: WorkflowMode; activeSkill?: WorkflowId }
export interface Job { id: string; conversationId: string; status: 'running' | 'completed' | 'stopped' | 'failed'; text: string; error: string; mode: 'mock' | 'deepseek'; skill?: WorkflowId; skillLabel?: string; skillVersion?: number }
export interface Progress { shotIndex: number; time: number; full: boolean }
export function boundedIndex(index: number, length: number): number { return Math.max(0, Math.min(Math.trunc(Number(index) || 0), length - 1)); }
export function mediaUrl(base: string, path: string): string {
  if (!/^https?:\/\//.test(base) || !/^(videos|clips|assets)\/[\w.-]+$/.test(path)) return '';
  return base.replace(/\/$/, '') + '/' + path;
}
export function normalizeProgress(value: Partial<Progress> | undefined, length: number): Progress {
  return { shotIndex: boundedIndex(value?.shotIndex || 0, length), time: Math.max(0, Number(value?.time) || 0), full: value?.full === true };
}
