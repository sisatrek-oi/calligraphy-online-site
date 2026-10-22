// Reading offsets and stored annotation offsets share the unchanged reviewed TXT.
export function annotationReading(source) {
  const starts=[],ends=[],chars=[];
  const lines=[...source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)].filter(m=>m[0]);
  const prefix=line=>(line.match(/^[\t ]*\[\d+\][\t ]*/)||[''])[0].length;
  const content=line=>line.slice(prefix(line)).replace(/\[\d{3,}\][\t ]*/g, '');
  const heading=line=>/^[\p{Script=Han}]{1,12}$/u.test(line.trim());
  for(let n=0;n<lines.length;n++) {
    const line=lines[n],skip=prefix(line[1]);
    // Some reviewed TXT pages have generated column labels glued inside a line.
    const inline=[...line[1].matchAll(/\[\d{3,}\][\t ]*/g)].filter(m=>m.index>=skip);
    for(let i=skip;i<line[1].length;i++){
      const label=inline.find(m=>m.index===i);
      if(label){i+=label[0].length-1;continue;}
      chars.push(line[1][i]);starts.push(line.index+i);ends.push(line.index+i+1);
    }
    if(!line[2])continue;
    const next=lines[n+1],numbered=next&&/^[\t ]*\[\d+\]/.test(next[1]);
    const before=content(line[1]).trim(),after=next?content(next[1]).trim():'';
    // Keep paragraph endings and headings; join column breaks within a sentence.
    if(numbered&&before&&after&&!/[。！？!?]([”’」』）)]*)$/u.test(before)&&!heading(before)&&!heading(after))continue;
    chars.push('\n');starts.push(line.index+line[1].length);ends.push(line.index+line[0].length);
  }
  const text=chars.join('');
  const visibleOffset=raw=>{let lo=0,hi=ends.length;while(lo<hi){const mid=(lo+hi)>>1;if(ends[mid]<=raw)lo=mid+1;else hi=mid;}return lo;};
  return {text,visibleOffset,sourceStart:offset=>starts[offset]??source.length,sourceEnd:offset=>offset?ends[offset-1]??source.length:0,
    ranges:ranges=>ranges.map(r=>({...r,start:visibleOffset(r.start),end:visibleOffset(r.end)})).filter(r=>r.end>r.start)};
}
