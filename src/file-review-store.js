/* Atomic revision checks prevent a second tab silently replacing the first tab's draft. */
(function (root) {
  let pending;
  function database() {
    if (!pending) pending = new Promise((resolve, reject) => {
      const request = indexedDB.open('shulun-file-review-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('浏览器本地存储不可用，请导出备份后再关闭'));
    });
    return pending;
  }
  async function all() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const req = db.transaction('records').objectStore('records').getAll();
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  async function save(record, revision) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records');
      const req = store.get(record.id); let next, error;
      req.onsuccess = () => {
        if ((req.result?.revision || 0) !== revision) { error = new Error('另一个标签页已修改这份草稿。先下载恢复文件，再刷新打开最新版本。'); tx.abort(); return; }
        next = { ...record, revision: revision + 1, savedAt: new Date().toISOString() }; store.put(next);
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = tx.onerror = () => reject(error || new Error('保存失败：请下载恢复文件，勿直接关闭页面'));
    });
  }
  root.ShulunReviewStore = { all, save };
})(globalThis);
