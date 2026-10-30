import test from 'node:test';import assert from 'node:assert/strict';
import {feedbackWindowRect} from '../src/feedback-window.js';
test('window stays inside the actual visible viewport, including keyboard, pan and rotated sizes',()=>{
 for(const width of [220,320,390,768,1470])for(const height of [140,220,420,700,900])for(const offsetTop of [0,120])for(const position of [null,{left:-500,top:-500},{left:2000,top:2000}]){
  const viewport={width,height,offsetLeft:25,offsetTop},r=feedbackWindowRect(viewport,position);
  assert.ok(r.left>=33&&r.top>=offsetTop+8);assert.ok(r.left+r.width<=25+width-8);assert.ok(r.top+r.height<=offsetTop+height-8);assert.ok(r.width>0&&r.height>0);
 }
});
test('desktop and phone use compact sizes without overwriting a valid dragged position',()=>{
 assert.equal(feedbackWindowRect({width:1470,height:900}).width,430);assert.equal(feedbackWindowRect({width:390,height:700}).width,340);
 const position={left:200,top:160},r=feedbackWindowRect({width:1470,height:900},position);assert.deepEqual({left:r.left,top:r.top},position);
});
