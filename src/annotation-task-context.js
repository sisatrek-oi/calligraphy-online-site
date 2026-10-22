import { annotationSource, annotationHref } from './annotation-source.js?v=release-20261022';
import { segmentHasPage } from './team-assignments.js?v=release-20261022';
import { readProgress } from './delivery-core.js?v=release-20261022';
import { annotationView } from './theory-annotations.js?v=release-20261022';

export function annotationTaskContext(storage,assignment,indexes,{includePages=false}={}) {
  const parts=new Map(),eligible=[];
  for(const segment of assignment.segments) {
    const saved=readProgress(storage,segment.part).value;parts.set(segment.part,saved);
    for(const page of indexes[segment.part]?.pages||[]) {
      if(!segmentHasPage(segment,page.page))continue;
      const review=saved.reviews[page.page]||{},source=annotationSource(page,review,{summary:true});
      if(!source)continue;
      const data=review.theoryAnnotations;
      const completed=source.text!==undefined?annotationView(data,source.text).completed:
        Boolean(data?.completion && data.source?.kind===source.kind && data.source?.revision===source.revision);
      const info=page.humanReviewedSummary;
      eligible.push({part:segment.part,page:page.page,completed,candidates:source.kind==='human-txt'||(source.kind==='personal'&&info?.matchingPersonalText===source.text)?info?.candidateCount||0:0});
    }
  }
  const recent=eligible.filter(p=>parts.get(p.part)?.annotationLastPage===p.page).sort((a,b)=>(Date.parse(parts.get(b.part)?.annotationSavedAt)||0)-(Date.parse(parts.get(a.part)?.annotationSavedAt)||0))[0];
  const target=recent||eligible.find(p=>!p.completed)||eligible[0];
  return {total:eligible.length,completed:eligible.filter(p=>p.completed).length,candidates:eligible.reduce((n,p)=>n+p.candidates,0),
    ...(includePages?{pages:eligible}:{}),
    ...(target?{part:target.part,page:target.page,href:annotationHref(assignment.id,target.part,target.page)}:{})};
}

export function unifiedAnnotationContext(storage,indexes) {
  const scope={id:null,segments:[{part:1,start:1,end:258},{part:2,start:259,end:527},{part:3,start:528,end:776},{part:4,start:777,end:1052}]};
  const context=annotationTaskContext(storage,scope,indexes,{includePages:true});
  return {...context,...(context.href?{href:context.href+'&scope=all'}:{})};
}
