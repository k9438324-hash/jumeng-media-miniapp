import { WorkflowMode } from '../domain';
import { api } from './api';
export interface WorkflowOption { id: WorkflowMode; label: string; description?: string; starter?: string; version?: number }
export const workflowModes: WorkflowOption[] = [
  { id: 'auto', label: '自动选择' },
  { id: 'hook', label: '开头优化' },
  { id: 'title', label: '标题与封面' },
  { id: 'flow', label: '口播逻辑检查' },
  { id: 'value', label: '内容价值评估' },
  { id: 'general', label: '现场拍摄' },
];
export function workflowLabel(id?: WorkflowMode, options = workflowModes): string {
  return options.find(item => item.id === id)?.label || workflowModes.find(item => item.id === id)?.label || '';
}
export async function publishedWorkflowModes(): Promise<WorkflowOption[]> {
  const result = await api<{ items: WorkflowOption[] }>('/skills');
  if (!result || !Array.isArray(result.items) || !result.items.some(item => item.id === 'general') || result.items.some(item => typeof item.id !== 'string' || typeof item.label !== 'string')) throw new Error('技能列表暂未同步');
  return [{id:'auto',label:'自动选择'},...result.items];
}
