import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
export default defineConfig({base:'./',publicDir:'portable/public',plugins:[react(),tailwindcss(),{
 name:'portable-entry-and-backups',enforce:'pre',
 transformIndexHtml:{order:'pre',handler(html){return html.replace('/src/main.tsx','/src/portable-main.tsx');}},
 resolveId(source){if(/(?:^|\/)utils\/storage(?:\.ts)?$/.test(source))return path.resolve('src/portable/browserStorageDisabled.ts');},
 generateBundle(_options,bundle){for(const output of Object.values(bundle)){if(output.type!=='chunk')continue;for(const name of Object.keys(output.modules))if(/\/node_modules\/(?:@firebase|firebase|firebase-admin)\//.test(name.replaceAll('\\','/'))){const queue=[name],seen=new Set<string>();const trace:string[]=[];while(queue.length&&seen.size<100){const current=queue.shift()!;if(seen.has(current))continue;seen.add(current);const info=this.getModuleInfo(current);if(current.includes('/src/'))trace.push(current);queue.push(...(info?.importers??[]),...(info?.dynamicImporters??[]));}throw Error('Firebase dependency in standalone build: '+name+' via '+trace.join(' -> '));}}},
}],build:{outDir:'build/portable-public',emptyOutDir:true},server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:4187',changeOrigin:false}}}});
