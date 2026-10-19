import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const sandbox=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(new URL('../src/device-session.js',import.meta.url),'utf8'),sandbox);
const session=sandbox.window.DeviceSession;
function disk(){const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
test('device session expires after 30 days, rejects corrupt/future records, and stores no password',()=>{
 const d=disk(),at=1900000000000;
 assert.equal(session.remember(d,'member-account',at),true);
 assert.equal(session.read(d,at+100).account,'member-account');
 assert.equal(session.read(d,at+session.lifetime),null);
 assert.equal(session.read(d,at-1),null);
 const raw=d.getItem(session.key);assert.equal(raw.includes('password'),false);
 d.setItem(session.key,'{bad');assert.equal(session.read(d,at),null);
 d.setItem(session.key,JSON.stringify({version:1,mode:'cloud',account:'x',createdAt:at,expiresAt:at+session.lifetime}));assert.equal(session.read(d,at),null);
});
test('logout removes both old and new demo memory without touching proofreading records',()=>{
 const d=disk();d.setItem('shulun-screening-v1-part-1','original');d.setItem('calligraphy-local-demo-session-v1','active');session.remember(d,'account');
 session.forget(d);assert.equal(session.read(d),null);assert.equal(session.wasSignedOut(d),true);assert.equal(d.getItem('calligraphy-local-demo-session-v1'),null);assert.equal(d.getItem('shulun-screening-v1-part-1'),'original');
});
test('blocked storage fails closed without throwing',()=>{
 const d={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
 assert.equal(session.read(d),null);assert.equal(session.remember(d,'x'),false);assert.equal(session.forget(d),false);assert.equal(session.wasSignedOut(d),true);
});
