/* Task selection is presentation only; the existing workspace owns all rows. */
(() => {
  const esc = value => window.WorkspaceUI.esc(value);
  function markup(tasks) {
    return `<section class="entry-task-board" aria-labelledby="entryTaskHeading">
      <header class="entry-task-heading"><p class="workspace-kicker">条目整理 / 选择任务</p><h2 id="entryTaskHeading">条目整理</h2><p>选择任务，再进入共享主表。</p></header>
      <div class="entry-task-list">${tasks.map((task, index) => `<article class="entry-task-card" data-entry-task="${esc(task.id)}" aria-labelledby="entryTaskTitle${index}">
        <div class="entry-task-card-head"><span class="entry-task-icon" aria-hidden="true">${window.WorkspaceUI.icon('entries')}</span><div class="entry-task-title"><h3 id="entryTaskTitle${index}">${esc(task.name)}</h3><p>${task.count} 条${task.current ? ' · 当前任务' : ''}</p></div><button type="button" class="action-button" data-entry-task-open="${esc(task.id)}" aria-label="进入主表：${esc(task.name)}">进入主表 <span aria-hidden="true">→</span></button></div>
        <div class="entry-task-roster" data-roster-host></div>
      </article>`).join('')}</div>
      <p class="entry-task-footnote">成员名单保存在本机；成员共享本任务主表，条目未按成员重新分配。</p>
    </section>`;
  }
  function attach({storage, openTask}) {
    document.querySelectorAll('[data-entry-task-open]').forEach(button => button.addEventListener('click', () => openTask(button.dataset.entryTaskOpen)));
    for (const card of document.querySelectorAll('[data-entry-task]')) {
      const id = card.dataset.entryTask, host = card.querySelector('[data-roster-host]');
      let members, closed = true, error = '';
      try {members = window.EntryTaskMembers.read(storage, id).members; closed = window.EntryTaskMembers.folded(storage, id);} catch (e) {error = e.message || '成员名单暂不可用。';}
      const panelId = `entryMembers-${encodeURIComponent(id)}`;
      host.innerHTML = `<div class="entry-members-head"><button type="button" class="entry-members-toggle" aria-expanded="${!closed}" aria-controls="${esc(panelId)}" ${members ? '' : 'disabled'}><span>成员 <span data-member-count>（${members?.length ?? '—'}）</span></span><span data-member-fold-text>${closed ? '展开' : '收起'}</span><span class="entry-member-chevron" aria-hidden="true">⌄</span></button><button type="button" class="quiet-button" data-member-add ${members ? '' : 'disabled'}>＋ 添加成员</button></div>
        <div id="${esc(panelId)}" class="entry-members-content" ${closed ? 'hidden' : ''}><ul class="entry-members-list"></ul><p class="entry-member-caption">沿用团队七人名单，可在此补充协作成员。</p></div>
        <form class="entry-member-form" hidden><label>成员姓名<input name="name" autocomplete="off" maxlength="80" required placeholder="输入成员姓名" aria-label="成员姓名" /></label><div><button type="button" class="quiet-button" data-member-cancel>取消</button><button type="submit" class="action-button">添加</button></div></form>
        <p class="entry-member-notice" role="status" aria-live="polite"></p>`;
      const toggle = host.querySelector('.entry-members-toggle'), content = host.querySelector('.entry-members-content'), list = host.querySelector('ul'), form = host.querySelector('form'), input = form.elements.name, add = host.querySelector('[data-member-add]'), notice = host.querySelector('[role="status"]');
      function message(text, failed = false) {notice.textContent = text; notice.classList.toggle('error', failed);}
      function drawMembers() {list.innerHTML = (members || []).map(member => `<li><span class="entry-member-avatar" aria-hidden="true">${esc([...member.name][0])}</span><span>${esc(member.name)}</span></li>`).join(''); host.querySelector('[data-member-count]').textContent = `（${members?.length ?? '—'}）`;}
      function fold(value) {closed = value; content.hidden = value; toggle.setAttribute('aria-expanded', String(!value)); host.querySelector('[data-member-fold-text]').textContent = value ? '展开' : '收起';}
      function cancel() {form.hidden = true; form.reset(); message(''); add.focus();}
      drawMembers(); if (error) message(error, true);
      toggle.addEventListener('click', () => {
        fold(!closed);
        try {window.EntryTaskMembers.setFolded(storage, id, closed);} catch {message('本次已切换，浏览器未能记住展开状态。', true);}
      });
      add.addEventListener('click', () => {form.hidden = false; message(''); input.focus();});
      host.querySelector('[data-member-cancel]').addEventListener('click', cancel);
      form.addEventListener('keydown', event => {if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); cancel();}});
      form.addEventListener('submit', event => {
        event.preventDefault();
        try {
          const result = window.EntryTaskMembers.add(storage, id, input.value);
          members = window.EntryTaskMembers.read(storage, id).members;
          drawMembers(); fold(false); form.hidden = true; form.reset();
          try {window.EntryTaskMembers.setFolded(storage, id, false);} catch { /* Name saved; preference is optional. */ }
          message(`已添加 ${result.member.name}，名单已保存在本机。`); add.focus();
        } catch (e) {message(e.message?.includes('成员') || e.message?.includes('名单') || e.message?.includes('任务') ? e.message : '添加未保存，请检查浏览器存储空间后重试。', true); input.focus();}
      });
      card.refreshEntryRoster = () => {
        try {members = window.EntryTaskMembers.read(storage, id).members; drawMembers(); toggle.disabled = false; add.disabled = false;} catch (e) {toggle.disabled = true; add.disabled = true; message(e.message, true);}
      };
    }
  }
  window.addEventListener('storage', event => {
    if (event.key !== null && !event.key?.startsWith('shulun-entry-members-v1:')) return;
    for (const card of document.querySelectorAll('[data-entry-task]')) card.refreshEntryRoster?.();
  });
  window.EntryTaskBoard = {markup, attach};
})();
