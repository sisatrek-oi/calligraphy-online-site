import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function runtime() {
 const scripts=[],window={};
 const context=vm.createContext({window,Promise,Error,setTimeout,clearTimeout,document:{
  createElement:()=>({remove(){this.removed=true;}}),head:{append:script=>scripts.push(script)}
 }});
 vm.runInContext(fs.readFileSync(new URL('../src/cloud-store.js',import.meta.url),'utf8'),context);
 return {window,scripts,cloud:window.CalligraphyCloud};
}

test('SDK loading is shared, asynchronous, and only requested on demand',async()=>{
 const r=runtime();assert.equal(r.scripts.length,0);
 const a=r.cloud.loadSupabaseSdk(),b=r.cloud.loadSupabaseSdk();
 assert.equal(r.scripts.length,1);assert.equal(r.scripts[0].async,true);
 r.window.supabase={createClient:()=>({})};r.scripts[0].onload();await Promise.all([a,b]);
 await r.cloud.loadSupabaseSdk();assert.equal(r.scripts.length,1);
});

test('stalled SDK and network failures release the loader for a real retry',async()=>{
 const r=runtime();await assert.rejects(r.cloud.loadSupabaseSdk({timeoutMs:10}),/超时/);
 assert.equal(r.scripts[0].removed,true);
 const retry=r.cloud.loadSupabaseSdk();assert.notEqual(r.scripts[1].src,r.scripts[0].src);r.scripts[1].onerror();await assert.rejects(retry,/未能载入/);
 assert.equal(r.scripts[1].removed,true);
 const success=r.cloud.loadSupabaseSdk();r.window.supabase={createClient:()=>({})};r.scripts[2].onload();await success;
});

test('cloud client keeps provider session options; disabled cloud loads nothing',async()=>{
 const r=runtime();assert.equal(r.cloud.createSupabaseClient({enabled:false}),null);assert.equal(r.scripts.length,0);
 let args;r.window.supabase={createClient:(...value)=>{args=value;return 'client';}};
 await r.cloud.loadSupabaseSdk();assert.equal(r.scripts.length,0);
 assert.equal(r.cloud.createSupabaseClient({enabled:true,supabaseUrl:'https://example.invalid',supabaseAnonKey:'public-test'}),'client');
 assert.deepEqual(JSON.parse(JSON.stringify(args[2])),{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
});
