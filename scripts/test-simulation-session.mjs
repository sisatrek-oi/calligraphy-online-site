import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/simulation-session.js',import.meta.url),'utf8');
function browser(user, backend) {
  const events = {}, nodes = new Map(), calls = [];
  let logout = false, reloaded = false;
  const node = () => ({style:{}, setAttribute(){}, append(){}, hidden:false, textContent:''});
  const window = {localStorage:{setItem(){}}, addEventListener(name,fn){events[name]=fn;}, fetch:async (url,options={}) => {
    calls.push({url,options}); let status=200,data;
    if(url.endsWith('/me')) data={user};
    else if(url.endsWith('/storage') && options.method==='PUT') {
      const body=JSON.parse(options.body), stored=backend[user];
      if(body.revision!==stored.revision){status=409;data={error:'冲突，请先备份'};}
      else{backend[user]={items:body.items,revision:stored.revision+1};data={revision:stored.revision+1};}
    } else if(url.endsWith('/storage')) data=structuredClone(backend[user]);
    else if(url.endsWith('/logout')){logout=true;data={ok:true};}
    else data={ok:true};
    return {ok:status===200,status,json:async()=>data};
  }};
  const context=vm.createContext({window, URL, Headers, Request, Blob, setTimeout,clearTimeout,
    location:{href:'http://127.0.0.1:8773/',origin:'http://127.0.0.1:8773',reload(){reloaded=true;}},
    document:{getElementById:id=>nodes.get(id)||null,createElement:node,body:{append(n){nodes.set(n.id,n);}}}});
  Object.defineProperty(context,'fetch',{get:()=>window.fetch});
  vm.runInContext(source,context);
  return {session:window.CalligraphySession,calls,events,nodes,get logout(){return logout;},get reloaded(){return reloaded;}};
}

test('five sessions save disjoint workspaces and hydrate after reload',async()=>{
  const backend=Object.fromEntries([1,2,3,4,5].map(n=>[`test0${n}`,{items:{},revision:0}]));
  for(const user of Object.keys(backend)){
    const a=browser(user,backend); await a.session.ready;
    a.session.storage.setItem('calligraphy-workspace',user); await a.session.flush();
    const b=browser(user,backend); await b.session.ready;
    assert.equal(b.session.storage.getItem('calligraphy-workspace'),user);
    assert.equal(b.session.storage.length,1);
    const write=a.calls.find(c=>c.options.method==='PUT');
    assert.equal(write.options.headers.get('X-Simulation-User'),user);
  }
});
test('stale page fails without overwriting peer and blocks logout until resolved',async()=>{
  const backend={test01:{items:{},revision:0}};
  const a=browser('test01',backend),b=browser('test01',backend);
  await Promise.all([a.session.ready,b.session.ready]);
  a.session.storage.setItem('calligraphy-workspace','new');await a.session.flush();
  b.session.storage.setItem('calligraphy-workspace','stale');
  await assert.rejects(b.session.flush(),/冲突/);
  assert.equal(backend.test01.items['calligraphy-workspace'],'new');
  assert.throws(()=>b.session.storage.setItem('calligraphy-x','bad'),/冲突/);
  await assert.rejects(b.session.logout(),/冲突/);assert.equal(b.logout,false);
});
test('logout flushes pending changes before invalidating session',async()=>{
  const backend={test01:{items:{},revision:0}};const a=browser('test01',backend);await a.session.ready;
  a.session.storage.setItem('calligraphy-private','saved'); await a.session.logout();
  assert.equal(backend.test01.items['calligraphy-private'],'saved');assert.equal(a.logout,true);assert.equal(a.reloaded,true);
  const writes=a.calls.filter(c=>c.options.method);assert.ok(writes[0].url.endsWith('/storage'));assert.ok(writes[1].url.endsWith('/logout'));
});
test('unauthenticated adapter cannot mutate workspace',async()=>{
  const a=browser(null,{});await a.session.ready;
  assert.throws(()=>a.session.storage.setItem('calligraphy-private','x'),/登录/);
  assert.equal(a.session.storage.length,0);
});
