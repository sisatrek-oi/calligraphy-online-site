import fs from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const check=process.argv.includes('--check');
for(const name of ['index','pdf-gaps-index']){
 const index=JSON.parse(await fs.readFile(new URL('../comparison-data/'+name+'.json',import.meta.url),'utf8'));
 const path=new URL('../'+index.file.replace(/^\.\//,''),import.meta.url),raw=await fs.readFile(path);
 if(createHash('sha256').update(raw).digest('hex')!==index.sha256)throw Error('Frozen review source hash mismatch: '+name);
 const target=new URL(path.href+'.gz');
 if(check){if(!gunzipSync(await fs.readFile(target)).equals(raw))throw Error('Rebuild compressed review assets: '+name);}
 else await fs.writeFile(target,gzipSync(raw,{level:9}));
}
const standard=new URL('../annotation-data/wolai-standard.json',import.meta.url),standardRaw=await fs.readFile(standard),standardTarget=new URL(standard.href+'.gz');
if(check){if(!gunzipSync(await fs.readFile(standardTarget)).equals(standardRaw))throw Error('Rebuild compressed standard corpus asset.');}
else await fs.writeFile(standardTarget,gzipSync(standardRaw,{level:9}));
console.log(check?'Compressed review and standard corpus assets match frozen sources.':'Compressed review and standard corpus assets built.');
