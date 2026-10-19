import { isVerified } from './collation-core.js?v=20261013-typo-only';
import { isTaskPage } from './screening-page-policy.js?v=20261003-trim';
import { humanMarkLabel } from './human-mark.js?v=human-mark-20261019';

export const METRICS_VERSION = 'collation-v1';
export const rate = (n, d) => d ? Math.round(n / d * 10000) / 100 : null;
export const showRate = value => value === null ? '—' : `${value}%`;
// Formatting (generated column labels and whitespace) is not textual correction.
export const metricText = value => String(value ?? '').replace(/^\s*\[\d+\][ \t]*/gm, '').replace(/\s/gu, '');

export function editDistance(before, after) {
  let a = Array.from(before), b = Array.from(after);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  a = a.slice(start, endA); b = b.slice(start, endB);
  if (a.length < b.length) [a, b] = [b, a];
  if (!b.length) return a.length;
  // Reject unexpectedly large imported page texts rather than freezing the UI
  // or presenting an approximation as an exact correction count.
  if (a.length * b.length > 8_000_000) return null;
  const row = Uint32Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return row[b.length];
}

const cache = new WeakMap();
export function pageMetrics(item, review = {}) {
  const d = review?.collation || {};
  const previous = cache.get(d);
  if (previous?.raw === item.ocr) return previous.value;
  const started = typeof d.text === 'string';
  const verified = started && isVerified(d, item.ocr);
  const baseline = d.metricBaseline;
  const known = baseline?.version === 1 && typeof baseline.text === 'string';
  const before = known ? metricText(baseline.text) : '';
  const after = started ? metricText(d.text) : '';
  const changes = started && known ? editDistance(before, after) : null;
  const value = { page: item.page, local: item.local, started, verified,
    status: verified ? '已校验' : started ? '草稿' : '未开始',
    baseline: known ? String(baseline.label || '已保存底稿') : '缺少历史底稿',
    baselineChars: known ? Array.from(before).length : null,
    currentChars: started ? Array.from(after).length : null, changes,
    modificationRate: changes === null ? null : rate(changes, Array.from(before).length),
    unresolved: started ? (d.text.match(/[□�]|【待核[^】]*】/g) || []).length : 0,
  };
  if (review?.collation) cache.set(d, { raw: item.ocr, value });
  return value;
}

export function taskMetrics(pages, reviews = {}) {
  const rows = pages.filter(item => isTaskPage(item.page)).map(item => {
    const review = reviews[item.page] || {};
    return { ...pageMetrics(item, review), seen: review.seen === true,
      question: typeof review.question === 'string' && !!review.question.trim(),
      candidates: Array.isArray(review.candidates) ? review.candidates.length : 0 };
  });
  const sum = key => rows.reduce((n, row) => n + Number(row[key] || 0), 0);
  const comparable = rows.filter(row => row.changes !== null && row.baselineChars > 0);
  const changes = comparable.reduce((n, row) => n + row.changes, 0);
  const baselineChars = comparable.reduce((n, row) => n + row.baselineChars, 0);
  return { version: METRICS_VERSION, total: rows.length, started: sum('started'), verified: sum('verified'),
    seen: sum('seen'), completionRate: rate(sum('verified'), rows.length),
    draft: rows.filter(row => row.started && !row.verified).length,
    unstarted: rows.filter(row => !row.started).length,
    unresolvedPages: rows.filter(row => row.unresolved > 0).length, unresolved: sum('unresolved'),
    questionPages: sum('question'), candidates: sum('candidates'),
    comparablePages: comparable.length, changes, baselineChars,
    modificationRate: rate(changes, baselineChars), rows };
}

export function metricsCsv({ part, person, pages, reviews, savedAt = '', unsaved = false }) {
  const m = taskMetrics(pages, reviews);
  const rows = [
    ['指标版本', '分工', '校勘人', '记录范围', '最后保存时间', '可比较页', '底稿字符数', '净修改字符数', '净修改率(%)'],
    [m.version, part, person, unsaved ? '当前页面含未保存修改' : '当前浏览器记录', savedAt, m.comparablePages, m.baselineChars, m.changes, m.modificationRate],
    [], ['口径', '净修改率=编辑距离/比较底稿字数；忽略栏号及空白，保留标点，可超过100%。旧草稿无明确底稿时不计算。该数值只供负责人复核修改幅度，不代表校勘准确率。'],
    [], ['原PDF物理页', '分册页', '校勘状态', '比较底稿', '底稿字符数', '当前字符数', '净修改字符数', '净修改率(%)'],
    ...m.rows.map(r => [r.page, r.local, humanMarkLabel(pages.find(p=>p.page===r.page),reviews[r.page]), r.baseline, r.baselineChars, r.currentChars, r.changes, r.modificationRate]),
  ];
  const cell = value => {
    const text = String(value ?? '');
    return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}
