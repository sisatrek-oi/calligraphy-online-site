import {build}from 'esbuild';import {resolve}from 'node:path';import fs from 'node:fs/promises';
const check=process.argv.includes('--check'),routes={
 'annotation-tasks':'annotation-task-overview','annotation':'annotation-chapter-reader','annotation-review':'annotation-review','annotation-structure':'annotation-structure','annotation-compare':'annotation-compare','annotation-gap-tasks':'annotation-gap-tasks','annotation-gaps':'annotation-gaps'
};
const result=await build({entryPoints:[...new Set(Object.values(routes))].map(n=>'src/'+n+'.js'),outdir:'src/browser-apps',entryNames:'[name]-[hash]',chunkNames:'shared-[hash]',bundle:true,splitting:false,format:'esm',target:'es2022',minify:true,legalComments:'none',metafile:true,write:false,plugins:[{name:'local-module-version',setup(b){b.onResolve({filter:/\.js\?v=/},args=>({path:resolve(args.resolveDir,args.path.split('?')[0])}));}}]});
async function output(path,bytes){if(check){if(!(await fs.readFile(path)).equals(Buffer.from(bytes)))throw Error('Rebuild browser apps: '+path);}else{await fs.mkdir(new URL('.',new URL(path,'file://'+process.cwd()+'/')),{recursive:true});await fs.writeFile(path,bytes);}}
for(const file of result.outputFiles)await output(file.path,file.contents);
const outputs=result.metafile.outputs;
for(const [route,source]of Object.entries(routes)){
 const [entry]=Object.entries(outputs).find(([,v])=>v.entryPoint==='src/'+source+'.js'),preloads=new Set();
 function visit(path){for(const i of outputs[path].imports)if(i.kind==='import-statement'&&!preloads.has(i.path)){preloads.add(i.path);visit(i.path);}}
 visit(entry);
 const path=route+'.html',original=await fs.readFile(path,'utf8'),html=original.replace(/<!-- loading-preloads:start -->[\s\S]*?<!-- loading-preloads:end -->\n?/,'').replace(/(<script type="module" src=")[^"]+("[^>]*>)/,'$1./'+entry+'$2');
 const links=[entry,...preloads].map(p=>'<link rel="modulepreload" href="./'+p+'">');if(route==='annotation-tasks')links.unshift('<link rel="preload" as="fetch" crossorigin href="./annotation-data/chapter-catalogue.json.gz?v=loading-20261028b">');
 if(route==='annotation-compare')links.unshift('<link rel="preload" as="fetch" crossorigin href="./comparison-data/task-catalogue.json.gz?v=loading-20261028b">');
 await output(path,html.replace('</head>','<!-- loading-preloads:start -->\n'+links.join('\n')+'\n<!-- loading-preloads:end -->\n</head>'));
}
const manifest='src/browser-apps/manifest.json',current=Object.keys(outputs);
// Keep previous content hashes available to pages already cached by clients.

await output(manifest,JSON.stringify(current,null,2)+'\n');
console.log(check?'Browser apps and preloads match source modules.':'Browser apps built.');
