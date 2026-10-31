import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedScanRect,validateScanRegion,scanImagePath} from '../src/scan-region.js';

const region=()=>({page:281,rect:{x:.2,y:.3,width:.4,height:.1},imageWidth:1600,imageHeight:2400,imageSha256:'a'.repeat(64)});
test('scan rectangles are normalized in image coordinates, regardless of view scale or drag direction',()=>{
 const box={left:100,top:-200,width:400,height:600};
 assert.deepEqual(normalizedScanRect(box,{x:180,y:-20},{x:340,y:40}),{x:.2,y:.3,width:.4,height:.1});
 assert.deepEqual(normalizedScanRect(box,{x:340,y:40},{x:180,y:-20}),{x:.2,y:.3,width:.4,height:.1});
 assert.deepEqual(normalizedScanRect({left:50,top:10,width:200,height:300},{x:90,y:100},{x:170,y:130}),{x:.2,y:.3,width:.4,height:.1});
 assert.deepEqual(normalizedScanRect(box,{x:50,y:-300},{x:550,y:500}),{x:0,y:0,width:1,height:1});
});
test('scan region restore validates page, image version, dimensions and normalized bounds',()=>{
 assert.deepEqual(validateScanRegion(region()),region());assert.equal(scanImagePath(281),'./screening-data/scans/page-0281.jpg');
 for(const mutate of [r=>r.page=20001,r=>r.page=0,r=>r.imageSha256='bad',r=>r.imageWidth=0,r=>r.imageHeight=1.5,r=>r.rect.width=0,r=>r.rect.x=-.1,r=>r.rect.y=.95,r=>r.rect.height=NaN,r=>r.rect=null]){
  const r=region();mutate(r);assert.throws(()=>validateScanRegion(r),/原图|框选|页码/);
 }
});
