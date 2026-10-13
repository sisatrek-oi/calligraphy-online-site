import { isVerified } from './collation-core.js?v=20261013-typo-only';

export function pageStatus(item, reviews) {
  const review = reviews[item.page] || {};
  return isVerified(review.collation, item.ocr) ? 'verified'
    : review.collation?.text !== undefined ? 'draft' : 'unstarted';
}

export function progressSummary(pages, reviews) {
  return pages.reduce((counts, item) => {
    counts[pageStatus(item, reviews)] += 1;
    return counts;
  }, { verified: 0, draft: 0, unstarted: 0 });
}

export function matchesFilter(item, reviews, filter) {
  const status = pageStatus(item, reviews);
  return filter === 'all' || (filter === 'pending' ? status !== 'verified' : status === filter);
}

// Wrap to earlier omissions, but never select the page just completed.
export function nextPendingIndex(pages, reviews, index) {
  for (let offset = 1; offset < pages.length; offset += 1) {
    const candidate = (index + offset) % pages.length;
    if (pageStatus(pages[candidate], reviews) !== 'verified') return candidate;
  }
  return -1;
}

export function initialPageIndex(pages, requested, lastPage) {
  const target = Number(requested ?? lastPage);
  if (!Number.isInteger(target) || target < pages[0].page || target > pages.at(-1).page) {
    return target > pages.at(-1).page ? pages.length - 1 : 0;
  }
  return pages.findIndex(item => item.page >= target);
}

// The snapshot is advanced only after a successful write. Failed writes remain
// retryable; stale tabs cannot silently overwrite newer work in this browser.
export function createProgressStore(storage, key, part) {
  let snapshot;
  return {
    read() {
      const raw = storage.getItem(key);
      const value = raw === null ? null : JSON.parse(raw);
      if (value !== null && (value.version !== 1 || value.part !== part ||
          !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews))) {
        throw new Error('invalid-progress');
      }
      snapshot = raw;
      return value;
    },
    save(value) {
      try {
        if (snapshot === undefined || storage.getItem(key) !== snapshot) return { ok: false, conflict: true };
        const serialized = JSON.stringify(value);
        storage.setItem(key, serialized);
        snapshot = serialized;
        return { ok: true };
      } catch {
        return { ok: false, conflict: false };
      }
    },
    allowBackupReplacement() { snapshot = storage.getItem(key); },
    hasChanged() {
      try { return storage.getItem(key) !== snapshot; } catch { return false; }
    },
  };
}
