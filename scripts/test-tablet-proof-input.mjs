import test from 'node:test';
import assert from 'node:assert/strict';
import {textareaSourceOffset} from '../src/tablet-proof-input.js';

test('native textarea offsets map to stored CRLF without moving a replacement to another line',()=>{
  for(const raw of ['甲\r\n乙\r\n𠮷丙','甲\n乙\n𠮷丙','甲\r乙\r𠮷丙']) {
    const shown=raw.replace(/\r\n?/g,'\n');
    for(let i=0;i<=shown.length;i++)assert.equal(raw.slice(0,textareaSourceOffset(raw,i)).replace(/\r\n?/g,'\n').length,i);
    const at=shown.indexOf('丙'),source=textareaSourceOffset(raw,at);
    assert.equal(raw.slice(0,source)+'手写'+raw.slice(textareaSourceOffset(raw,at+1)),raw.replace('丙','手写'));
  }
});
