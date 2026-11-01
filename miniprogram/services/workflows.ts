import { WorkflowMode } from '../domain';
export const workflowModes: { id: WorkflowMode; label: string }[] = [
  { id: 'auto', label: '自动选择' },
  { id: 'hook', label: '开头优化' },
  { id: 'title', label: '标题与封面' },
  { id: 'flow', label: '口播逻辑检查' },
  { id: 'value', label: '内容价值评估' },
  { id: 'general', label: '现场拍摄' },
];
export function workflowLabel(id?: WorkflowMode): string {
  return workflowModes.find(item => item.id === id)?.label || '';
}
