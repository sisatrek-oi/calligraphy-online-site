"""Locate immutable approved source windows in PDF/TXT order. Never rank by AI roles."""
import json,re,hashlib,difflib,collections,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def read(n):return json.loads((root/n).read_text())
def digest(t):return hashlib.sha256(t.encode()).hexdigest()
def units(t):return len(t.encode('utf-16-le'))//2
def norm(t):return ''.join(re.findall(r'[\u3400-\u9fff\U00020000-\U0003134f]',t))
def chars(t):
 out=[];offset=0
 for match in re.finditer(r'\[\d{3,}\]|[\s\S]',t):
  text=match.group();n=units(text)
  if len(text)==1 and norm(text):out.append((text,offset,offset+n))
  offset+=n
 return out
structure=read('annotation-data/pdf-structure-evidence.json');corpus=read('annotation-data/wolai-standard.json');old=read('annotation-data/chapters.json');references=read('annotation-data/pdf-mapping-references.json')['pages'];oldc={c['id']:c for c in old['chapters']};refs={p['page']:p for p in references}
for p in references:assert digest(p['text'])==p['source']['textSha256']
for fact in structure['headingFacts']:
 p=refs[fact['page']];assert p['source']['textSha256']==fact['textSha256'] and p['text'].encode('utf-16-le')[2*fact['start']:2*fact['end']].decode('utf-16-le')==fact['quote']
 assert hashlib.sha256((root/fact['scan']).read_bytes()).hexdigest()==fact['scanSha256']
# Original chapter block labels identify running headers, not prose or semantic ordering.
decor=collections.defaultdict(list)
for c in old['chapters']:
 for f in c['fragments']:
  for b in f['blocks']:
   if b.get('decoration'):decor[f['page']].append((b['start'],b['end']))
refchars={n:[(ch,a,z) for ch,a,z in chars(p['text']) if not any(a>=x and z<=y for x,y in decor[n])] for n,p in refs.items()}
lookup={};records=[]
for c in corpus['index']['chapters']:
 for f in c['fragments']:
  p=next(p for p in corpus['pages'] if p['page']==f['page'])
  for i,m in enumerate(p['source']['provenance']):
   bid='word-paragraph-'+m['id'].rsplit('-',1)[-1] if m['origin']=='wolai-word' else m['id'];r={'c':c,'p':p,'m':m,'points':collections.defaultdict(collections.Counter)};records.append(r);lookup.setdefault((m['page_id'],bid),[]).append(r)
# The frozen comparison has unit-wise positions in both approved TXT versions.
# Equal matching spans supply evidence; changed characters remain paragraph-level locations.
matches=read('annotation-data/pdf-comparison-anchors.json')
workvotes=collections.defaultdict(collections.Counter)
for a in matches:
 if a['page'] not in refs or refs[a['page']]['source']['textSha256']!=a['textSha256']:continue
 for bid,sourceStart,sourceEnd,pdfStart,pdfEnd in a['spans']:
  for r in lookup.get((a['reference'],bid),[]):
   m=r['m']
   if m['rawStart']<=sourceStart and sourceEnd<=m['rawEnd']:
    raw=m['start']+sourceStart-m['rawStart'];r['points'][raw][(a['page'],pdfStart)]+=20;workvotes[r['c']['workId']][a['workId']]+=1
# New work IDs use only existing comparison links to original work scopes, never title guesses.
scopes={}
for c in corpus['index']['chapters']:
 original=oldc.get(c['id'])
 if original:
  cs=[v for v in old['chapters'] if v['workId']==original['workId']];first=min((v['start']['page'],v['start']['offset']) for v in cs);last=max((v['end']['page'],v['end']['offset']) for v in cs);scopes[c['id']]=(*first,*last)
 elif workvotes[c['workId']]:
  wid=workvotes[c['workId']].most_common(1)[0][0];cs=[v for v in old['chapters'] if v['workId']==wid];scopes[c['id']]=(*min((v['start']['page'],v['start']['offset']) for v in cs),*max((v['end']['page'],v['end']['offset']) for v in cs))
# PDF247/263/276/277 were visually checked; the original index conflated three sections.
related=[c for c in corpus['index']['chapters'] if c['workId']=='wolai-eUY9eJTNVfZVNAuDNFyaYF' or c['id']=='work-079']
for c in related:scopes[c['id']]=(247,0,281,0)
searches={}
globalScope=(min(refs),0,max(refs)+1,0);searchScopes=set(scopes.values())|{globalScope}
for scope in sorted(searchScopes):
 if scope in searches:continue
 points=[(ch,n,a,z) for n,cs in refchars.items() for ch,a,z in cs if (scope[0],scope[1])<=(n,a)<(scope[2],scope[3])];text=''.join(x[0] for x in points);indices={}
 for k in [12,8,6]:
  d=collections.defaultdict(list)
  for i in range(max(0,len(text)-k+1)):d[text[i:i+k]].append(i)
  indices[k]=d
 searches[scope]=(points,indices)
for r in records:
 m=r['m'];p=r['p'];scope=scopes.get(r['c']['id'])
 if m['origin']=='legacy-reviewed-txt':continue
 globalSearch=not scope
 if not scope:scope=globalScope
 source=p['text'].encode('utf-16-le')[2*m['start']:2*m['end']].decode('utf-16-le');sc=chars(source);text=''.join(ch for ch,_,_ in sc);rp,indices=searches[scope]
 # A standalone source title may be shorter than the gram threshold; require an exact full TXT line.
 if len(text)<=22:
  headings=[]
  for n in refs:
   if not scope[0]<=n<=scope[2]:continue
   offset=0
   for line in refs[n]['text'].splitlines(keepends=True):
    if norm(re.sub(r'\[\d{3,}\]','',line))==text:headings.append((n,offset))
    offset+=units(line)
  if len(headings)==1:r['points'][m['start']][headings[0]]+=100;r['headingLocated']=True
 # 字格 is an explicit printed list: its entry labels identify variant wordings independently of source order.
 if p['page']==20073 and m['start']<1069 and '：' in source:
  label=source.split('：',1)[0];alias=structure['entryAlias'];label=alias['referenceLabel'] if label==alias['sourceLabel'] else label;hits=[]
  for n in [277,278,279,280]:
   t=refs[n]['text'];lo=393 if n==277 else 0;hi=303 if n==280 else units(t)
   for match in re.finditer(re.escape(label)+r'[ \t]',t):
    at=units(t[:match.start()])
    if lo<=at<hi:hits.append((n,at))
  if len(hits)==1:r['points'][m['start']][hits[0]]+=200;r['entryLocated']=True

 for k in ([12] if globalSearch else [12,8,6]):
  for i in range(max(0,len(text)-k+1)):
   hits=indices[k].get(text[i:i+k],[])
   if len(hits)!=1:continue
   at=hits[0]
   for j in range(k):
    _,pdfPage,pdfStart,_=rp[at+j];raw=m['start']+sc[i+j][1];r['points'][raw][(pdfPage,pdfStart)]+=k
# Physical insertion cuts put independent supplements back inside large Wolai blocks.
insertions=collections.defaultdict(set)
for r in records:
 m=r['m']
 if m['origin']=='legacy-reviewed-txt':insertions[m['page_id']].update([m['rawStart'],m['rawEnd']])
plans={};audit=[]
for r in records:
 m=r['m'];p=r['p'];points=[]
 for offset,votes in sorted(r['points'].items()):
  scope=scopes.get(r['c']['id']);votes=collections.Counter({location:count for location,count in votes.items() if not scope or (scope[0],scope[1])<=location<(scope[2],scope[3])});best=votes.most_common()
  if not best:continue
  if len(best)==1 or best[0][1]>best[1][1]:points.append((offset,*best[0][0]))
 if r['c']['id'] not in scopes and len(points)<min(40,max(6,int(len(norm(p['text'].encode('utf-16-le')[2*m['start']:2*m['end']].decode('utf-16-le')))*.65))):points=[]
 end=next((x['start'] for x in p['source']['provenance'] if x['start']>m['start']),len(p['text'].encode('utf-16-le'))//2)
 pieces=[]
 if m['origin']=='legacy-reviewed-txt':pieces=[[m['start'],end,m['page_id'],m['rawStart'],m['rawEnd'],'exact']]
 elif points:
  cuts={m['start']:0};previous=None
  for i,point in enumerate(points):
   off,page,pos=point
   if previous:
    _,pn,pp=previous
    if page!=pn or pos<pp-8 or any(pp<x<=pos for x in insertions[page]):cuts[off]=i
   previous=point
  starts=sorted(cuts)
  for i,a in enumerate(starts):
   z=starts[i+1] if i+1<len(starts) else end;inside=[t for t in points if a<=t[0]<z]
   if not inside:continue
   # A window may include version differences, so this is a paragraph anchor, not exact character identity.
   body=p['text'].encode('utf-16-le')[2*a:2*z].decode('utf-16-le');sufficient=r.get('entryLocated') or r.get('headingLocated') or len(inside)>=min(8,max(1,int(len(norm(body))*.4)))
   pieces.append([a,z,inside[0][1],inside[0][2],inside[-1][2]+1,'paragraph'] if sufficient else [a,z,None,None,None,'unlocated'])
 else:pieces=[[m['start'],end,None,None,None,'unlocated']]
 plan=plans.setdefault(str(p['page']),{'sha256':p['source']['textSha256'],'pieces':[]});plan['pieces'].extend(pieces)
 audit.append({'chapter':r['c']['id'],'source':p['page'],'id':m['id'],'start':m['start'],'end':m['end'],'anchors':len(points),'status':pieces[0][5],'pieces':pieces})
# Image-only locations are recorded as passage ordinals, never mislabelled as TXT UTF16 coordinates.
for fact in structure.get('scanParagraphFacts',[])+structure.get('txtParagraphFacts',[]):
 page=fact['source'];p=next(p for p in corpus['pages'] if p['page']==page);assert p['source']['textSha256']==fact['sourceTextSha256'];a,z=fact['start'],fact['end'];assert p['text'].encode('utf-16-le')[2*a:2*z].decode('utf-16-le').startswith(fact['quotePrefix'])
 if 'order' in fact:
  assert hashlib.sha256((root/f"screening-data/scans/page-{fact['pdfPage']:04d}.jpg").read_bytes()).hexdigest()==fact['scanSha256'];start=end=fact['order'];status='scan-checked'
 else:
  assert refs[fact['pdfPage']]['source']['textSha256']==fact['referenceSha256'];start,end,status=fact['pdfStart'],fact['pdfEnd'],'paragraph'
 pieces=[]
 for x,y,pn,ps,pe,st in plans[str(page)]['pieces']:
  if y<=a or x>=z:pieces.append([x,y,pn,ps,pe,st]);continue
  if x<a:pieces.append([x,a,pn,ps,pe,st])
  if y>z:pieces.append([z,y,pn,ps,pe,st])
 pieces.append([a,z,fact['pdfPage'],start,end,status]);plans[str(page)]['pieces']=pieces
# Exact same-location duplicate wording is a parallel source version, not another paragraph.
versionCandidates=collections.defaultdict(list)
for r in records:
 m=r['m']
 if m['origin']=='legacy-reviewed-txt':continue
 word=norm(r['p']['text'].encode('utf-16-le')[2*m['start']:2*m['end']].decode('utf-16-le'))
 for a,z,page,start,end,status in plans[str(r['p']['page'])]['pieces']:
  if page is not None and status!='scan-checked' and a<m['end'] and z>m['start']:versionCandidates[page].append((start,end,word))
for r in records:
 m=r['m']
 if m['origin']!='legacy-reviewed-txt':continue
 word=norm(r['p']['text'].encode('utf-16-le')[2*m['start']:2*m['end']].decode('utf-16-le'))
 matched=False;candidate=False
 for start,end,other in versionCandidates[m['page_id']]:
  if start>=m['rawEnd'] or end<=m['rawStart']:continue
  if len(word)>=4 and start<=m['rawStart'] and end>=m['rawEnd'] and word in other:matched=True;break
  if len(word)>=12:
   left=other.find(word[:4]);right=other.find(word[-4:],left+4) if left>=0 else -1
   if right>=0 and len(word)*.5<=right+4-left<=len(word)*2:candidate=True
 if matched or candidate:
  for piece in plans[str(r['p']['page'])]['pieces']:
   if m['start']<=piece[0]<m['end']:piece[5]='parallel' if matched else 'parallel-candidate'
# Source headings differ from PDF headings. Their locations are explicit scan-checked facts.
for page,start,end,pdfPage,factIndex in [(20071,0,4,248,0),(20072,0,4,263,1)]:
 pdfStart=structure['headingFacts'][factIndex]['start']
 plan=plans[str(page)];plan['pieces']=[x for x in plan['pieces'] if not(start<=x[0] and x[1]<=end)];plan['pieces'].append([start,end,pdfPage,pdfStart,pdfStart,'heading'])
# The original TXT list and the standard list are parallel versions of the same printed entries, not sequential prose.
for piece in plans['20073']['pieces']:
 if structure['parallelVersion']['start']<=piece[0]<structure['parallelVersion']['end']:piece[5]='parallel'
for page,plan in plans.items():
 plan['pieces'].sort();at=0
 for a,z,*_ in plan['pieces']:assert a==at and z>a,(page,at,a,z);at=z
 assert at==units(next(p for p in corpus['pages'] if p['page']==int(page))['text'])
# Resolve original IDs through the existing fold/alias table before checking chapter membership.
known={c['id']:c for c in corpus['index']['chapters']};starts={};boundaryAudit=[]
for c in old['chapters']:
 cid=corpus['index'].get('chapterAliases',{}).get(c['id'],c['id'])
 if cid not in known:continue
 siblings=[x for x in old['chapters'] if x['workId']==c['workId']];opening=c['id']==siblings[0]['id'];title=norm(c['author'] if opening and c['author']!='编者' else re.sub(r'〔.*?〕','',c['title']));hits=[]
 for n in range(max(1,c['start']['page']-1),c['start']['page']+2):
  if n not in refs:continue
  offset=0
  for line in refs[n]['text'].splitlines(keepends=True):
   if norm(re.sub(r'\[\d{3,}\]','',line))==title and title and not any(offset>=a and offset<b for a,b in decor[n]):hits.append((n,offset))
   offset+=units(line)
 point=hits[0] if len(hits)==1 else (c['start']['page'],c['start']['offset'])
 if cid not in starts or point<starts[cid]:starts[cid]=point
 boundaryAudit.append({'chapter':cid,'originalStart':c['start'],'mappedStart':point,'method':('exact-printed-author' if opening else 'exact-printed-heading') if len(hits)==1 else 'original-boundary-unresolved'})
starts.update({'wolai-eUY9eJTNVfZVNAuDNFyaYF-58d5165648':(247,0),'wolai-eUY9eJTNVfZVNAuDNFyaYF-0e19897745':(263,387),'work-079':(276,344)})
windows=[]
for i,(cid,point) in enumerate(sorted(starts.items(),key=lambda item:item[1])):
 ordered=sorted(starts.items(),key=lambda item:item[1]);end=ordered[i+1][1] if i+1<len(ordered) else max((c['end']['page'],c['end']['offset']) for c in old['chapters']);windows.append({'chapter':cid,'start':point,'end':end})
transfers=[{'source':20071,'start':11890,'end':13479,'chapter':'wolai-eUY9eJTNVfZVNAuDNFyaYF-0e19897745'}]
for r in records:
 m=r['m']
 if r['c']['id']!='work-079' or m['origin']!='legacy-reviewed-txt':continue
 position=(m['page_id'],m['rawStart'])
 if position<(276,344):transfers.append({'source':20073,'start':m['start'],'end':next((x['start'] for x in r['p']['source']['provenance'] if x['start']>m['start']),units(r['p']['text'])),'chapter':'wolai-eUY9eJTNVfZVNAuDNFyaYF-'+('58d5165648' if position<(263,387) else '0e19897745')})
# Generated separators are not paragraphs. Rejoin source windows that were adjacent in the approved PDF/TXT.
legacyRecords=sorted((r for r in records if r['m']['origin']=='legacy-reviewed-txt'),key=lambda r:(r['m']['page_id'],r['m']['rawStart']))
flowJoins=[]
def printedHeading(r):
 m=r['m'];body=r['p']['text'].encode('utf-16-le')[2*m['start']:2*m['end']].decode('utf-16-le');word=norm(body)
 if not word or len(word)>25:return False
 raw=refs[m['page_id']]['text'];at=0
 for line in raw.splitlines(keepends=True):
  end=at+units(line)
  if at<=m['rawStart']<end and norm(re.sub(r'\[\d{3,}\]','',line))==word:return True
  at=end
 return False
for left,right in zip(legacyRecords,legacyRecords[1:]):
 a,b=left['m'],right['m'];samePage=a['page_id']==b['page_id'] and a['rawEnd']==b['rawStart'];crossPage=False
 if a['page_id']+1==b['page_id']:
  pf=[f for c in old['chapters'] for f in c['fragments'] if f['page']==a['page_id']];nf=[f for c in old['chapters'] for f in c['fragments'] if f['page']==b['page_id']]
  end=max((x['end'] for f in pf for x in f['blocks'] if not x.get('decoration')),default=-1);start=min((x['start'] for f in nf for x in f['blocks'] if not x.get('decoration')),default=-1)
  last=left['p']['text'].encode('utf-16-le')[2*a['start']:2*a['end']].decode('utf-16-le').rstrip()
  crossPage=a['rawEnd']==end and b['rawStart']==start and last and last[-1] not in '。！？；：.!?;:'
 if (samePage or crossPage) and not printedHeading(left) and not printedHeading(right):flowJoins.append([left['p']['page'],a['end'],right['p']['page'],b['start']])
# Check remaining mapped windows against actual printed section boundaries within the same work.
for c in corpus['index']['chapters']:
 if c['id'] not in starts or c['id']=='work-079':continue
 own=next(w for w in windows if w['chapter']==c['id'])
 for f in c['fragments']:
  for a,z,pdfPage,pdfStart,pdfEnd,status in plans[str(f['page'])]['pieces']:
   if pdfPage is None or status=='parallel' or not(f['start']<=a<f['end']) or any(t['source']==f['page'] and t['start']<=a<t['end'] for t in transfers):continue
   point=(pdfPage,pdfStart)
   if own['start']<=point<own['end']:continue
   targets=[w['chapter'] for w in windows if w['start']<=point<w['end'] and known[w['chapter']]['workId']==c['workId']]
   if len(targets)==1 and targets[0]!=c['id']:transfers.append({'source':f['page'],'start':a,'end':z,'chapter':targets[0]})
value={'revision':'pdf-txt-order-20261029','sourceRevision':corpus['index']['revision'],'plans':plans,'physicalChapters':windows,'flowJoins':flowJoins,'transfers':transfers,'titles':{'wolai-eUY9eJTNVfZVNAuDNFyaYF-58d5165648':'述书赋上','wolai-eUY9eJTNVfZVNAuDNFyaYF-0e19897745':'述书赋下'},'sections':{'work-079':[[structure['headingFacts'][2]['page'],structure['headingFacts'][2]['start'],'《述书赋》语例字格'],[structure['headingFacts'][3]['page'],structure['headingFacts'][3]['start'],'字格']]}}
js='// Generated from approved TXT coordinates and checked PDF chapter boundaries.\nexport const pdfReadingOrder='+json.dumps(value,ensure_ascii=False,separators=(',',':'))+';\n';target=root/'src/annotation-pdf-order-data.js'
if '--check' in sys.argv:assert target.read_text()==js,'Rebuild PDF/TXT reading order'
else:target.write_text(js)
# Report the final plan, including scan-checked paragraphs and parallel versions, rather than initial match guesses.
for row in audit:
 final=[p for p in plans[str(row['source'])]['pieces'] if p[0]<row['end'] and p[1]>row['start']];row['pieces']=final
 row['status']='parallel' if final and all(p[5].startswith('parallel') for p in final) else 'located' if final and all(p[2] is not None for p in final) else 'partial' if any(p[2] is not None for p in final) else 'unlocated'
report={'records':len(audit),'located':sum(a['status'] in ['located','parallel'] for a in audit),'partial':sum(a['status']=='partial' for a in audit),'parallel':sum(a['status']=='parallel' for a in audit),'unlocated':[a for a in audit if a['status'] in ['unlocated','partial']],'transfers':transfers,'scopes':scopes,'boundaries':boundaryAudit,'physicalChapters':windows}
if '--audit' in sys.argv:(root.parent.parent/'2026-10-29-pdf-txt-chapter-order/mapping-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'records':report['records'],'located':report['located'],'unlocated':len(report['unlocated']),'pieces':sum(len(p['pieces']) for p in plans.values()),'transfers':len(transfers)}))
