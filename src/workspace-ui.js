/* Shared navigation; contains no task data and never changes proofreading records. */
(() => {
  const icons = {
    home:'M3 10 12 3l9 7v11h-6v-7H9v7H3z',
    proof:'M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6',
    entries:'M4 6h16 M4 12h16 M4 18h11',
    materials:'M3 7h7l2 2h9v12H3z',
    delivery:'M12 16V3 M7 8l5-5 5 5 M4 14v7h16v-7',
  };
  const items = [
    ['home','任务首页','./index.html#home',''],
    ['proof','逐页校勘','./team-tasks.html','对照原图校勘全文，在原文中圈选书论。'],
    ['entries','条目整理','./index.html#detail','整理书论条目、核对证据与独立审核。'],
    ['materials','材料管理','./materials.html','查看原始材料、工作正文与历史版本。'],
    ['delivery','成果交付','./delivery.html','导出成果、恢复进度与检查回收文件。'],
  ];
  const mobileMedia=window.matchMedia?.('(max-width:760px)');
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = key => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[key]||icons.home}"/></svg>`;
  const tabs = mode => `<nav class="entry-view-tabs" aria-label="条目视图"><a href="./index.html#detail" ${mode==='table'?'aria-current="page"':''}>全部条目</a><a href="./index.html#review" ${mode==='review'?'aria-current="page"':''}>需回检</a><a href="./review.html" ${mode==='independent'?'aria-current="page"':''}>独立审核</a></nav>`;
  function mount(active) {
    if(!document.body)return;
    document.body.classList.add('workspace-ui');
    document.body.dataset.workspaceView=active;
    let nav=document.querySelector('#workspaceNavigation');
    if(!nav){nav=document.createElement('aside');nav.id='workspaceNavigation';nav.className='workspace-navigation';document.body.prepend(nav);}
    nav.inert=Boolean(mobileMedia?.matches && !document.body.classList.contains?.('workspace-nav-open'));
    nav.innerHTML=`<a class="workspace-brand" href="./index.html#home"><img src="./src/assets/shulun-mark.png" alt=""/><span>书论工作区</span></a><nav aria-label="工作区导航">${items.map(([key,label,href])=>`<a href="${href}" ${key===active?'aria-current="page"':''}>${icon(key)}<span>${label}</span></a>`).join('')}</nav><div class="workspace-nav-bottom"><a href="./index.html#settings">设置与账户</a><span>同设备保留工作位置</span></div>`;
    let scrim=document.querySelector('#workspaceNavScrim');if(!scrim){scrim=document.createElement('button');scrim.id='workspaceNavScrim';scrim.className='workspace-nav-scrim';scrim.type='button';scrim.setAttribute?.('aria-label','关闭导航');scrim.tabIndex=-1;scrim.onclick=()=>{document.body.classList.remove('workspace-nav-open');nav.inert=Boolean(mobileMedia?.matches);document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');};document.body.prepend(scrim);}
    let mobile=document.querySelector('#workspaceMobileNav');
    if(!mobile){mobile=document.createElement('div');mobile.id='workspaceMobileNav';mobile.className='workspace-mobile-navigation';document.body.prepend(mobile);mobile.innerHTML='<button type="button" aria-expanded="false" aria-controls="workspaceNavigation">☰</button><a href="./index.html#home">书论工作区</a>';mobile.querySelector('button').onclick=()=>{const open=document.body.classList.toggle('workspace-nav-open');mobile.querySelector('button').setAttribute('aria-expanded',String(open));nav.inert=Boolean(mobileMedia?.matches&&!open);};}
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.body.classList.remove('workspace-nav-open');document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');const nav=document.querySelector('#workspaceNavigation');if(nav)nav.inert=Boolean(mobileMedia?.matches);}});
  mobileMedia?.addEventListener('change',()=>{document.body?.classList.remove('workspace-nav-open');const nav=document.querySelector('#workspaceNavigation');if(nav)nav.inert=mobileMedia.matches;document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');});
  document.addEventListener('click',event=>{if(!event.target.closest?.('#workspaceNavigation a'))return;document.body.classList.remove('workspace-nav-open');const nav=document.querySelector('#workspaceNavigation');if(nav)nav.inert=Boolean(mobileMedia?.matches);document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');});
  window.WorkspaceUI={mount,icon,esc,tabs,homeMarkup:()=>`<section class="navigation-home" aria-label="工作导航"><p class="workspace-kicker">书论工作区 / 任务首页</p><h1>从这里开始</h1><div class="navigation-tiles">${items.slice(1).map(([key,label,href,description])=>`<a class="navigation-tile" href="${href}"><span class="navigation-tile-icon">${icon(key)}</span><span><strong>${label}</strong><small>${description}</small></span><span class="navigation-arrow" aria-hidden="true">→</span></a>`).join('')}</div></section>`};
})();
