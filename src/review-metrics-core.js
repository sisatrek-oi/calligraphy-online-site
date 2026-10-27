import { isVerified } from './collation-core.js?v=index-archive-20261027';
import { isTaskPage } from './screening-page-policy.js?v=index-archive-20261027';

export const recordLabels = { confirmation: '逐页确认', note: '人工备注', replacement: '直接替换' };
export function replacementKind(record) {
  return !record.before ? '增补' : !record.after ? '删除' : '替换';
}

// These are retained records, not a complete keystroke/undo journal.
export function readLocalTraces(storage) {
  const records = [], problems = [];
  for (const part of [1, 2, 3, 4]) {
    try {
      const raw = storage.getItem(`shulun-screening-v1-part-${part}`);
      if (raw === null) continue;
      const value = JSON.parse(raw);
      if (value?.version !== 1 || value.part !== part || !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews)) throw Error();
      for (const [number, review] of Object.entries(value.reviews)) {
        const page = Number(number), ranges = [[1,258],[259,527],[528,776],[777,1052]];
        if (!Number.isInteger(page) || page < ranges[part-1][0] || page > ranges[part-1][1] || !review || typeof review !== 'object' || Array.isArray(review)) { problems.push(`原第${part}份有无效页记录，已跳过`); continue; }
        if (!isTaskPage(page)) continue;
        const draft = review.collation || {};
        const base = { part, page, person: '逐条署名未知', source: `本机 · 原第${part}份`, at: '', timeKind: 'unknown' };
        if (isVerified(draft)) records.push({ ...base, kind: 'confirmation', person: draft.verifiedBy || '未署名', at: draft.verifiedAt || '', timeKind: 'page' });
        if (typeof review.question === 'string' && review.question.trim()) records.push({ ...base, kind: 'note', note: review.question, category: '人工备注（未分类）' });
        if (draft.edits != null && !Array.isArray(draft.edits)) problems.push(`原第${part}份第${page}页替换历史无法读取`);
        for (const edit of Array.isArray(draft.edits) ? draft.edits : []) {
          if (!edit || typeof edit.before !== 'string' || typeof edit.after !== 'string') { problems.push(`原第${part}份第${page}页有无效替换记录，已跳过`); continue; }
          records.push({ ...base, kind: 'replacement', before: edit.before, after: edit.after, at: edit.createdAt || '', timeKind: edit.createdAt ? 'event' : 'unknown', line: edit.line || '', char: edit.charStart || '', stale: edit.stale === true });
        }
      }
    } catch { problems.push(`原第${part}份本机记录无法读取；原记录保留`); }
  }
  return { records, problems: [...new Set(problems)] };
}

export function filterRecords(records, { part = '', kind = '', category = '', query = '' } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return records.filter(r => (!part || r.part === Number(part)) && (!kind || (kind === 'details' ? r.kind !== 'confirmation' : r.kind === kind)) && (!category || (r.kind === 'replacement' ? replacementKind(r) : r.category) === category) && (!needle || [r.page, r.person, r.note, r.before, r.after, r.category].join(' ').toLocaleLowerCase().includes(needle)));
}

export function summarize(records) {
  const pages = kind => new Set(records.filter(r => r.kind === kind).map(r => `${r.part}:${r.page}`)).size;
  return { confirmations: pages('confirmation'), notes: pages('note'), replacements: records.filter(r => r.kind === 'replacement').length, detailedPages: new Set(records.filter(r => r.kind !== 'confirmation').map(r => `${r.part}:${r.page}`)).size };
}
