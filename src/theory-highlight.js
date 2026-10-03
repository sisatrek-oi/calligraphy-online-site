// Reading assistance only: offsets refer to the unchanged editable TXT.
const technical = /用[笔筆]|[笔筆][法勢势意力鋒锋毫畫画]|[运運]筆|运笔|[执執]筆|执笔|[结結][体體構构]|布白|章法|中[锋鋒]|[侧側][锋鋒]|藏[锋鋒]|露[锋鋒]|提按|[顿頓]挫|使[转轉]|[点點][画畫]|[横橫][竖豎]|[转轉]折|[临臨][摹池]|[学學][书書]|[书書][勢势道理意妙體体者]|[论論][书書]|善[书書]|[篆隸隶楷行草章真][书書体體法]|八分|飛白|飞白|[笔筆]札/;
const judgment = /[遒勁劲健逸媚拙巧]|雄[强強浑渾]|骨[力氣气]|筋骨|[风風][骨格神韻韵流]|神[采彩韻韵]|[气氣][韻韵勢势象]|姿[態态媚]|[刚剛]柔|肥瘦|疏密|[险險][绝絕]|古雅|平正|[纵縱][横橫]|[頹颓]倒|[赞贊讚評评]曰|舞女|[龙龍][蛇飛飞]|[凤鳳][舞翥]|[银銀][钩鉤]|[铁鐵][画畫]|[书書]如|[笔筆]如/;
const domain = /[书書][法學学論论家體体]|[论論][书書]|[篆隸隶楷行草真][书書体體]|[笔筆]札|[钟鍾]繇|王羲之|王献之|王獻之|右[军軍]|[张張]芝|[张張]伯英|[颜顏]真卿|柳公[权權]|[欧歐][阳陽][询詢]|虞世南|[褚禇]遂良/;
const editorial = /出版|[编編]者|[编編]辑|[编編]印|印刷|[发發]行|[责責]任[编編][辑輯]|版[权權]|定[价價]|[邮郵][编編]|ISBN|目[录錄]|[选選][编編]|本[书書][收選选]|本次整理/;
const biography = /生[于於]|卒[于於]|官至|[历歷]任|仕[至於于]|[历歷].{0,8}司[马馬]|[人氏]，|[人氏]。|[书書]法[家評评]|[书書]法[评評][论論]家|[年月]生|[年月]卒/;

function sentences(source) {
  // Omit display-only column numbers and whitespace from matching, retain an exact offset map.
  const offsets = [], chars = [];
  let lineStart = true;
  for (let i = 0; i < source.length;) {
    if (lineStart) {
      const label = source.slice(i).match(/^[ \t]*\[\d+\][ \t]*/);
      if (label) { i += label[0].length; lineStart = false; continue; }
    }
    const c = source[i];
    if (!/\s/.test(c)) { chars.push(c); offsets.push(i); }
    lineStart = c === '\n'; i++;
  }
  const flat = chars.join(''), result = [];
  for (const match of flat.matchAll(/[^。！？!?；;]+[。！？!?；;]*|[。！？!?；;]+/g)) {
    // Bound unpunctuated OCR runs so one keyword cannot light up an entire page.
    for (let j = 0; j < match[0].length; j += 240) {
      const text = match[0].slice(j, j + 240), start = match.index + j;
      result.push({ text, start: offsets[start], end: offsets[start + text.length - 1] + 1 });
    }
  }
  return result;
}

export function theoryRanges(source = '') {
  const units = sentences(String(source));
  const pageDomain = units.some(unit => domain.test(unit.text));
  const types = units.map(unit => {
    const text = unit.text;
    const hasTechnical = technical.test(text), hasJudgment = judgment.test(text);
    if (editorial.test(text) && !/用[笔筆]|[结結][体體]|[笔筆]法|中[锋鋒]|藏[锋鋒]/.test(text)) return 'excluded';
    if (biography.test(text) && !hasJudgment && !/用[笔筆]|[笔筆]法|[结結][体體]|[学學][书書]/.test(text)) return 'excluded';
    return hasTechnical || (hasJudgment && pageDomain) ? 'theory' : '';
  });
  const result = [];
  units.forEach((unit, index) => {
    let type = types[index];
    if (!type && unit.text.length <= 180 && (types[index - 1] === 'theory' || types[index + 1] === 'theory')) type = 'context';
    if (type === 'theory' || type === 'context') result.push({ start: unit.start, end: unit.end, type });
  });
  return result;
}

export function highlightHtml(source, ranges) {
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  let position = 0, html = '';
  for (const range of ranges) {
    html += escape(source.slice(position, range.start));
    html += `<mark class="theory-${range.type}">${escape(source.slice(range.start, range.end))}</mark>`;
    position = range.end;
  }
  return html + escape(source.slice(position)) + '\n';
}
