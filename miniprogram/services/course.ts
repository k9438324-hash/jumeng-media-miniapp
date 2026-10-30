import bundled from '../data/course';
import type { Category, Lesson } from '../domain';
import { api } from './api';
export let course: { categories:Category[]; lessons:Lesson[] } = bundled;
let flight:Promise<void> | undefined;
export function refreshCourse():Promise<void> {
  if(!flight)flight=(async()=>{
    const updated=await api<typeof course>('/course');
    if(!updated || !Array.isArray(updated.categories) || !Array.isArray(updated.lessons))throw new Error('课程数据格式错误');
    course=updated;
  })().finally(()=>{flight=undefined;});
  return flight;
}
