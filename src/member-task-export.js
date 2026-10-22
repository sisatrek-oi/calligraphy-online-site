import { assignmentFor, assignmentSegment, segmentHasPage } from './team-assignments.js?v=release-20261022';
import { buildCollationBundle } from './collation-export.js?v=release-20261022';
import { zipStore } from './zip-store.js?v=20261018-bundle';

const clone = value => JSON.parse(JSON.stringify(value));
const key = part => `shulun-screening-v1-part-${part}`;
function validProgress(value, part) {
  if (!value || value.version !== 1 || value.part !== part || !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews))
    throw new Error(`原第${part}份进度无法读取，请先保留备份并恢复；未生成残缺任务包`);
  return value;
}

// All segments are captured synchronously, before the first material request.
export function captureMemberTask({ storage, member, currentProgress, unsaved = false, saveConflict = false }) {
  const assignment = assignmentFor(member);
  if (!assignment) throw new Error('请从本人任务入口导出。');
  assignmentSegment(member, currentProgress.part);
  const person = String(currentProgress.person || '').trim();
  if (!person) throw new Error('请先填写校勘人姓名。');
  return { member: assignment.id, exportedAt: new Date().toISOString(), unsaved, saveConflict,
    snapshots: assignment.segments.map(segment => {
      let progress;
      if (segment.part === currentProgress.part) progress = currentProgress;
      else {
        const raw = storage.getItem(key(segment.part));
        try { progress = raw === null ? { version:1, part:segment.part, reviews:{} } : JSON.parse(raw); }
        catch { throw new Error(`原第${segment.part}份进度无法读取，请先保留备份并恢复；未生成残缺任务包`); }
      }
      return { progress: clone({ ...validProgress(progress, segment.part), person }),
        unsaved: segment.part === currentProgress.part && unsaved,
        saveConflict: segment.part === currentProgress.part && saveConflict };
    }) };
}

export async function buildMemberTaskBundle({ member, snapshots, pagesByPart, exportedAt, unsaved = false, saveConflict = false }) {
  const assignment = assignmentFor(member);
  if (!assignment || !Array.isArray(snapshots) || snapshots.length !== assignment.segments.length ||
      snapshots.some((s,i) => s.progress.part !== assignment.segments[i].part)) throw new Error('本人任务页段不完整，未生成交付包。');
  const at = new Date(exportedAt), exportId = crypto.randomUUID();
  if (!Number.isFinite(at.getTime())) throw new Error('导出时间无效。');
  const bundles = [];
  for (const snapshot of snapshots) bundles.push(await buildCollationBundle({ ...snapshot,
    member, memberOnly:true, pages:pagesByPart[snapshot.progress.part] || [], exportedAt,
    exportId:`${exportId}-part-${snapshot.progress.part}` }));
  const manifest = { format:'shulun-member-task-bundle', version:1, member:assignment.id,
    exportedAt, exportId, scope:'仅本人被分配的页段，含本人正文、表格和范围内进度备份',
    unsaved:Boolean(unsaved || saveConflict), saveConflict:Boolean(saveConflict),
    pageNumbers:bundles.flatMap(b=>b.manifest.pageNumbers),
    segments:bundles.map(b=>({ name:b.name, part:b.manifest.part, pageNumbers:b.manifest.pageNumbers,
      sha256:null })) };
  for (let i=0;i<bundles.length;i++) manifest.segments[i].sha256 = Array.from(new Uint8Array(
    await crypto.subtle.digest('SHA-256',bundles[i].bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  const files = bundles.map(b=>({name:b.name,content:b.bytes}));
  files.push({name:'本人任务清单.json',content:JSON.stringify(manifest,null,2)},
    {name:'本人任务导出说明.txt',content:'\ufeff'+[
      `成员${assignment.id} ${assignment.name}：仅导出本人负责的 ${manifest.pageNumbers.length} 页。`,
      '各段ZIP含本人正文、校验表、修改率、候选、疑字、编辑历史及比较底稿；JSON也只含本人页段。',
      '其他成员页段、原图和PDF不在本包。本机原有完整记录未删除或改写。',
      '跨两段的成员只需交回这一个总ZIP；恢复时解压各段ZIP，在对应原分份导入进度JSON。',
      '本人范围JSON只更新包内记录，保留本机其他页段；同页存在修改时请先备份再核对。',
      manifest.unsaved?'注意：含当前页面尚未保存的修改，不表示已保存到浏览器。':'包内为点击时当前浏览器的进度，其他设备未交回的新稿不在其中。',
    ].join('\n')});
  return { name:`成员${assignment.id}-本人任务-${at.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}.zip`,
    bytes:zipStore(files,at), manifest };
}

export function mergeMemberBackup(saved, current, member = null) {
  validProgress(saved,current.part);
  const scope=saved.exportScope;
  if (!scope || scope.type!=='member-segment' || scope.part!==current.part) throw new Error('本人范围备份无效。');
  if (member !== null && scope.member !== member) throw new Error('备份不属于当前成员，请从对应成员任务恢复。');
  const segment=assignmentSegment(scope.member,current.part);
  if (!segment || scope.start!==segment.start || scope.end!==segment.end ||
      Object.entries(saved.reviews).some(([page,review])=>String(Number(page))!==page || !segmentHasPage(segment,Number(page)) ||
        !review || typeof review!=='object' || Array.isArray(review))) throw new Error('本人范围备份包含越界页码或无效记录，原进度未改变。');
  return clone({ ...current, person:saved.person || current.person, lastPage:saved.lastPage ?? current.lastPage,
    reviews:{...current.reviews,...saved.reviews} });
}
