import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewQueue,inReviewQueue,reviewTaskHref,reviewDirectoryHref} from '../src/annotation-review-flow.js';
const page={id:'P000041',page:41,workId:'work-006'},unlocated={id:'R009999',page:null,workId:'work-006'};
test('page and unlocated queues are disjoint and old deep links infer actual target',()=>{
 assert.equal(reviewQueue(new URLSearchParams(),page),'pages');
 assert.equal(reviewQueue(new URLSearchParams(),unlocated),'unlocated');
 assert.equal(reviewQueue(new URLSearchParams()),'pages');assert.equal(reviewQueue(new URLSearchParams('kind=reference-only')),'unlocated');assert.equal(reviewQueue(new URLSearchParams('kind=reference-only'),page),'pages');
 assert.ok(inReviewQueue(page,'pages'));assert.ok(!inReviewQueue(unlocated,'pages'));
 assert.ok(inReviewQueue(unlocated,'unlocated'));assert.ok(!inReviewQueue(page,'unlocated'));
 assert.throws(()=>reviewQueue(new URLSearchParams('queue=broken')));
 assert.throws(()=>reviewQueue(new URLSearchParams('queue=pages'),unlocated));
});
test('batch return never invents work scope, filter and search survive entry and return',()=>{
 const params=new URLSearchParams('batch=D&queue=pages&kind=han&status=defer&q=同词&item=P000005');
 const href=reviewTaskHref(page,params),target=new URL(href,'http://local/');
 assert.equal(target.searchParams.get('work'),null);assert.equal(target.searchParams.get('item'),page.id);
 const back=new URL(reviewDirectoryHref(target.searchParams,page),'http://local/');
 for(const key of ['batch','queue','kind','status','q'])assert.equal(back.searchParams.get(key),params.get(key));
 assert.equal(back.searchParams.get('work'),null);assert.equal(back.searchParams.get('view'),'directory');
});
test('explicit work scope and unlocated context remain intact without carrying unrelated parameters',()=>{
 const params=new URLSearchParams('batch=D&work=work-006&status=all&corpus=legacy&reviewEntry=secret');
 const url=new URL(reviewTaskHref(unlocated,params),'http://local/');
 assert.equal(url.searchParams.get('work'),'work-006');assert.equal(url.searchParams.get('queue'),'unlocated');
 assert.equal(url.searchParams.get('corpus'),null);assert.equal(url.searchParams.get('reviewEntry'),null);
 const group=new URL(reviewTaskHref(page,new URLSearchParams('batch=D'),{work:'work-006'}),'http://local/');
 assert.equal(group.searchParams.get('work'),'work-006');
});
test('gap return preserves actual scope and filters but never gains a work or comparison queue',()=>{
 const back=new URL(reviewDirectoryHref(new URLSearchParams('batch=E&kind=confirmed&status=pending&q=续书&queue=pages'),{id:'G001',workId:'w'},{gaps:true}),'http://local/');
 assert.equal(back.pathname,'/annotation-gap-tasks.html');assert.equal(back.searchParams.get('work'),null);
 assert.equal(back.searchParams.get('queue'),null);assert.equal(back.searchParams.get('status'),'pending');assert.equal(back.searchParams.get('q'),'续书');
});
