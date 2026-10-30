import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
export function harness(entry, additionalWx={}){
  const storage=new Map(), videos=[], events=[];
  let page;
  const wx={
    getStorageSync:k=>storage.get(k), setStorageSync:(k,v)=>storage.set(k,structuredClone(v)), removeStorageSync:k=>storage.delete(k),
    createVideoContext:(id)=>({pause:()=>videos.push(['pause',id]),seek:s=>videos.push(['seek',s]),play:()=>videos.push(['play',id])}),
    switchTab:o=>events.push(['switchTab',o.url]), setClipboardData:o=>events.push(['clipboard',o.data]),
    ...additionalWx,
  };
  const cache=new Map();
  function load(path){
    path=resolve(path);if(cache.has(path))return cache.get(path);
    if(path.endsWith('.json'))throw new Error('微信运行时不能直接require课程JSON；请先构建JS数据模块');
    const module={exports:{}};cache.set(path,module.exports);
    const context=vm.createContext({wx,Page:options=>{page=options;},App:()=>{},console,setTimeout,clearTimeout,Date,Math,Error,Promise});
    const fn=vm.runInContext('(function(require,module,exports){'+readFileSync(path,'utf8')+'\n})',context,{filename:path});
    fn(spec=>{let target=resolve(dirname(path),spec);if(!existsSync(target))target+='.js';return load(target);},module,module.exports);
    return module.exports;
  }
  const exports=load(entry);
  if(page){page.data=structuredClone(page.data);page.setData=(patch,callback)=>{Object.assign(page.data,structuredClone(patch));callback?.();};}
  return {page,exports,storage,videos,events,wx};
}
