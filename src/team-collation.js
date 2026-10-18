export function validCollation(value, page) {
  return value && value.page === page && typeof value.text === 'string' && value.text.trim() &&
    typeof value.revision === 'string' && typeof value.reviewedAt === 'string' &&
    Array.isArray(value.corrections) && Array.isArray(value.pending) && Array.isArray(value.notes) &&
    value.status === (value.pending.length ? '已修订·待核' : '已修改完毕');
}

export function publicationSummary(value) {
  return { revision: value.revision, reviewedAt: value.reviewedAt, status: value.status,
    corrections: value.corrections.length, pending: value.pending.length };
}

export function publicationLabel(item) {
  const info = item.publication;
  return info ? info.pending ? `已修订·待核${info.pending}处` : '已修改完毕' : '';
}
// Counts are verified against the versioned per-page sources by regression tests.
export const teamRelease = { date: '2026-10-18', parts: {
  1: { pages: 30, complete: 26, pending: 4 },
  2: { pages: 70, complete: 67, pending: 3 },
  3: { pages: 75, complete: 71, pending: 4 },
  4: { pages: 15, complete: 9, pending: 6 },
} };
