/* Shared navigation; contains no task data and never changes proofreading records. */
(() => {
  const icons = {
    home:'M3 10 12 3l9 7v11h-6v-7H9v7H3z',
    proof:'M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6',
    annotation:'M4 18l9-13 5 4-9 13H4z M12 7l5 4 M4 22h16',
    entries:'M4 6h16 M4 12h16 M4 18h11',
    materials:'M3 7h7l2 2h9v12H3z',
    delivery:'M12 16V3 M7 8l5-5 5 5 M4 14v7h16v-7',
  };
  const items = [
    ['home','任务首页','./index.html#home',''],
    ['proof','原文校对','./team-tasks.html','对照原图校对全文，确认人工校验完成。'],
    ['annotation','书论标注','./annotation-tasks.html','使用人工已校验正文，在原文中圈选书论。'],
    ['entries','条目整理','./index.html#detail','整理书论条目、核对证据与独立审核。'],
    ['materials','材料管理','./materials.html','查看原始材料、工作正文与历史版本。'],
    ['delivery','成果交付','./delivery.html','导出成果、恢复进度与检查回收文件。'],
  ];
  const mobileMedia=window.matchMedia?.('(max-width:760px)');
  const sidebarKey='shulun-sidebar-collapsed-v1';
  let sidebarCollapsed=false, sidebarMotionTimer;
  function finishSidebarMotion() {
    clearTimeout(sidebarMotionTimer);
    document.body?.classList.remove('workspace-sidebar-moving');
  }
  function animateSidebar() {
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
    clearTimeout(sidebarMotionTimer);
    document.body?.classList.add('workspace-sidebar-moving');
    sidebarMotionTimer=setTimeout(finishSidebarMotion,260);
  }
  try{sidebarCollapsed=localStorage.getItem(sidebarKey)==='1';}catch{}
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = key => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[key]||icons.home}"/></svg>`;
  const tabs = mode => `<nav class="entry-view-tabs" aria-label="条目视图"><a href="./index.html#detail" ${mode==='tasks'?'aria-current="page"':''}>任务列表</a><a href="./index.html#table" ${mode==='table'?'aria-current="page"':''}>全部条目</a><a href="./index.html#review" ${mode==='review'?'aria-current="page"':''}>需回检</a><a href="./review.html" ${mode==='independent'?'aria-current="page"':''}>独立审核</a></nav>`;
  function syncSidebar() {
    document.body?.classList[sidebarCollapsed?'add':'remove']('workspace-nav-collapsed');
    const toggle=document.querySelector('#workspaceSidebarToggle'),expanded=mobileMedia?.matches?document.body.classList.contains('workspace-nav-open'):!sidebarCollapsed,label=expanded?'收起侧边栏':'展开侧边栏';
    toggle?.setAttribute('aria-expanded',String(expanded));
    toggle?.setAttribute('aria-label',label);toggle?.setAttribute('title',label);
    const text=toggle?.querySelector('span');if(text)text.textContent=label;
    const scrim=document.querySelector('#workspaceNavScrim');if(scrim){const open=Boolean(mobileMedia?.matches&&document.body.classList.contains('workspace-nav-open'));scrim.inert=!open;scrim.setAttribute?.('aria-hidden',String(!open));}
    document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-label',document.body.classList.contains('workspace-nav-open')?'收起侧边栏':'展开侧边栏');
  }
  function mount(active) {
    if(!document.body)return;
    document.body.classList.add('workspace-ui');
    document.body.dataset.workspaceView=active;
    let nav=document.querySelector('#workspaceNavigation');
    if(!nav){nav=document.createElement('aside');nav.id='workspaceNavigation';nav.className='workspace-navigation';document.body.prepend(nav);}
    nav.inert=Boolean(mobileMedia?.matches && !document.body.classList.contains?.('workspace-nav-open'));
    if(!nav.querySelector('#workspaceSidebarToggle')) {
    nav.innerHTML=`<a class="workspace-brand" href="./index.html#home" aria-label="书论工作区" title="书论工作区"><img src="./src/assets/shulun-mark.png" alt=""/><span>书论工作区</span></a><nav aria-label="工作区导航">${items.map(([key,label,href])=>`<a href="${href}" aria-label="${label}" title="${label}" ${key===active?'aria-current="page"':''}>${icon(key)}<span>${label}</span></a>`).join('')}</nav><div class="workspace-nav-bottom"><button type="button" id="workspaceSidebarToggle" aria-controls="workspaceNavigation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg><span>收起侧边栏</span></button><a class="workspace-settings-link" href="./index.html#settings" aria-label="设置与账户" title="设置与账户"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-8 0v6"/></svg><span>设置与账户</span></a><span>同设备保留工作位置</span></div>`;
    nav.querySelector('#workspaceSidebarToggle').onclick=()=>{if(mobileMedia?.matches){document.body.classList.remove('workspace-nav-open');nav.inert=true;document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');syncSidebar();document.querySelector('#workspaceMobileNav button')?.focus();return;}animateSidebar();sidebarCollapsed=!sidebarCollapsed;try{localStorage.setItem(sidebarKey,sidebarCollapsed?'1':'0');}catch{}syncSidebar();};
    }
    for(const link of nav.querySelectorAll?.('nav>a')||[]) {
      if(link.getAttribute('href')===items.find(item=>item[0]===active)?.[2])link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    syncSidebar();
    let scrim=document.querySelector('#workspaceNavScrim');if(!scrim){scrim=document.createElement('button');scrim.id='workspaceNavScrim';scrim.className='workspace-nav-scrim';scrim.type='button';scrim.setAttribute?.('aria-label','关闭导航');scrim.tabIndex=-1;scrim.onclick=()=>{document.body.classList.remove('workspace-nav-open');nav.inert=Boolean(mobileMedia?.matches);document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');syncSidebar();document.querySelector('#workspaceMobileNav button')?.focus();};document.body.prepend(scrim);}
    let mobile=document.querySelector('#workspaceMobileNav');
    if(!mobile){mobile=document.createElement('div');mobile.id='workspaceMobileNav';mobile.className='workspace-mobile-navigation';document.body.prepend(mobile);mobile.innerHTML='<button type="button" aria-expanded="false" aria-controls="workspaceNavigation">☰</button><a href="./index.html#home">书论工作区</a>';mobile.querySelector('button').onclick=()=>{const open=document.body.classList.toggle('workspace-nav-open');mobile.querySelector('button').setAttribute('aria-expanded',String(open));nav.inert=Boolean(mobileMedia?.matches&&!open);syncSidebar();};}
    syncSidebar();
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const wasOpen=document.body.classList.contains('workspace-nav-open');document.body.classList.remove('workspace-nav-open');document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');const nav=document.querySelector('#workspaceNavigation');if(nav)nav.inert=Boolean(mobileMedia?.matches);syncSidebar();if(wasOpen&&mobileMedia?.matches)document.querySelector('#workspaceMobileNav button')?.focus();}});
  mobileMedia?.addEventListener('change',()=>{finishSidebarMotion();document.body?.classList.remove('workspace-nav-open');const nav=document.querySelector('#workspaceNavigation');if(nav)nav.inert=mobileMedia.matches;document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');syncSidebar();});
  function restoreSidebarPreference(){finishSidebarMotion();try{sidebarCollapsed=localStorage.getItem(sidebarKey)==='1';}catch{}syncSidebar();}
  window.addEventListener('pageshow',restoreSidebarPreference);
  window.addEventListener('pagereveal',restoreSidebarPreference);
  window.addEventListener('storage',event=>{if(event.key===sidebarKey||event.key===null){finishSidebarMotion();sidebarCollapsed=event.key===null?false:event.newValue==='1';syncSidebar();}});
  document.addEventListener('click',event=>{if(!event.target.closest?.('#workspaceNavigation a'))return;finishSidebarMotion();document.body.classList.remove('workspace-nav-open');const nav=document.querySelector('#workspaceNavigation');if(nav)nav.inert=Boolean(mobileMedia?.matches);document.querySelector('#workspaceMobileNav button')?.setAttribute('aria-expanded','false');syncSidebar();});
  let activeTransition;
  function transition(update) {
    finishSidebarMotion();
    if(!document.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return update();
    activeTransition?.skipTransition();
    try {
      activeTransition=document.startViewTransition(update);
      activeTransition.ready.catch(()=>{});activeTransition.finished.catch(()=>{});
      return activeTransition;
    } catch {return update();}
  }
  window.WorkspaceUI={mount,transition,icon,esc,tabs,homeMarkup:()=>`<section class="navigation-home" aria-label="工作导航"><p class="workspace-kicker">书论工作区 / 任务首页</p><h1>从这里开始</h1><div class="navigation-tiles">${items.slice(1).map(([key,label,href,description])=>`<a class="navigation-tile" href="${href}"><span class="navigation-tile-icon">${icon(key)}</span><span><strong>${label}</strong><small>${description}</small></span><span class="navigation-arrow" aria-hidden="true">→</span></a>`).join('')}</div></section>`};
  function bootstrap() {
    document.documentElement.dataset.workspacePageMotion=typeof document.startViewTransition==='function'?'native':'instant';
    const file=location.pathname.split('/').pop()||'index.html';
    const views={'index.html':location.hash==='#detail'||location.hash==='#table'||location.hash==='#review'?'entries':location.hash==='#ingest'?'materials':'home','team-tasks.html':'proof','screening.html':'proof','annotation-tasks.html':'annotation','annotation.html':'annotation','materials.html':'materials','delivery.html':'delivery','review.html':'entries'};
    if(views[file])mount(views[file]);
  }
  if(typeof MutationObserver!=='undefined' && document.documentElement) {
    if(document.body)bootstrap();
    else {const observer=new MutationObserver(()=>{if(document.body){observer.disconnect();bootstrap();}});observer.observe(document.documentElement,{childList:true});}
  }
})();
