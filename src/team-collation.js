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
export const teamRelease = { date: '2026-10-26', parts: {
  1: { pages: 248, complete: 212, pending: 36 },
  2: { pages: 236, complete: 197, pending: 39 },
  3: { pages: 249, complete: 227, pending: 22 },
  4: { pages: 195, complete: 180, pending: 15 },
} };
