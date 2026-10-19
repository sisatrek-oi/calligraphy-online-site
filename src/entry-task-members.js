/* Local display rosters only: never accounts, assignments, or review authors. */
(() => {
  const prefix = 'shulun-entry-members-v1:';
  const defaults = Object.freeze(['肖源', '郑雨荻', '宋品宣', '帅睿', '新增成员5', '新增成员6', '新增成员7']
    .map((name, index) => Object.freeze({id: `team-${index + 1}`, name})));
  function key(id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('任务标识无效。');
    return prefix + encodeURIComponent(id);
  }
  function nameOf(value) {
    const name = String(value ?? '').normalize('NFKC').trim();
    if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('请输入1–40字的成员姓名，不含换行。');
    return name;
  }
  const identity = name => name.normalize('NFKC').toLocaleLowerCase();
  function decode(raw, baseMembers = defaults) {
    if (raw === null) return {version: 1, customMembers: []};
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('成员名单无法读取，已保留原记录，请先备份浏览器数据。'); }
    if (payload?.version !== 1 || !Array.isArray(payload.customMembers) || payload.customMembers.length > 200)
      throw new Error('成员名单格式暂不支持，已保留原记录。');
    const ids = new Set(baseMembers.map(m => m.id)), names = new Set(baseMembers.map(m => identity(m.name)));
    for (const member of payload.customMembers) {
      if (!member || typeof member.id !== 'string' || !member.id || member.id.length > 100 ||
          typeof member.name !== 'string' || nameOf(member.name) !== member.name || ids.has(member.id) || names.has(identity(member.name)))
        throw new Error('成员名单内容异常，已保留原记录。');
      ids.add(member.id); names.add(identity(member.name));
    }
    return payload;
  }
  function read(storage, id, baseMembers = defaults) {
    const payload = decode(storage.getItem(key(id)), baseMembers);
    return {payload, members: [...baseMembers, ...payload.customMembers]};
  }
  function add(storage, id, value, baseMembers = defaults) {
    const name = nameOf(value), storageKey = key(id), before = storage.getItem(storageKey), payload = decode(before, baseMembers);
    if ([...baseMembers, ...payload.customMembers].some(m => identity(m.name) === identity(name))) throw new Error('这个任务中已有同名成员。');
    if (payload.customMembers.length >= 200) throw new Error('成员数量已达上限。');
    const member = {id: `member-${crypto.randomUUID()}`, name, addedAt: new Date().toISOString()};
    const next = {...payload, customMembers: [...payload.customMembers, member]};
    const serialized = JSON.stringify(next);
    if (storage.getItem(storageKey) !== before) throw new Error('其他页面更新了成员名单，请再次添加。');
    storage.setItem(storageKey, serialized);
    return {...next, member};
  }
  function folded(storage, id) {
    const value = storage.getItem(key(id) + ':folded');
    return value !== '0';
  }
  function setFolded(storage, id, value) { storage.setItem(key(id) + ':folded', value ? '1' : '0'); }
  window.EntryTaskMembers = {read, add, key, folded, setFolded, defaults};
})();
