/* This remembers the existing static demo gate, never a server/cloud identity. */
(() => {
  const key='calligraphy-device-session-v1', signedOutKey='calligraphy-device-signed-out-v1';
  const lifetime=30*24*60*60*1000;
  function read(storage,now=Date.now()) {
    try{const v=JSON.parse(storage.getItem(key)||'null');return v?.version===1&&v.mode==='local-demo'&&typeof v.account==='string'&&v.account.length>0&&Number.isFinite(v.createdAt)&&Number.isFinite(v.expiresAt)&&v.createdAt<=now&&v.expiresAt>now&&v.expiresAt-v.createdAt===lifetime?v:null;}catch{return null;}
  }
  function remember(storage,account,now=Date.now()) {
    try{storage.setItem(key,JSON.stringify({version:1,mode:'local-demo',account:String(account),createdAt:now,expiresAt:now+lifetime}));storage.removeItem(signedOutKey);return true;}catch{return false;}
  }
  function forget(storage){try{storage.removeItem(key);storage.removeItem('calligraphy-local-demo-session-v1');storage.setItem(signedOutKey,'true');return true;}catch{return false;}}
  function wasSignedOut(storage){try{return storage.getItem(signedOutKey)==='true';}catch{return true;}}
  window.DeviceSession={key,lifetime,read,remember,forget,wasSignedOut};
})();
