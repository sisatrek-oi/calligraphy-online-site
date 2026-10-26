import test from 'node:test';import assert from 'node:assert/strict';
import {validateReviewerName} from '../src/review-entry.js';
test('reviewer names preserve explicit Chinese and supplementary characters, trimming only edges',()=>{assert.equal(validateReviewerName('  王𠀀 · 乙  '),'王𠀀 · 乙');assert.equal(validateReviewerName('甲'.repeat(40)),'甲'.repeat(40));});
test('invalid or missing reviewer names cannot silently become an author',()=>{for(const value of [null,undefined,{},'', '  ', '甲'.repeat(41),'甲\n乙','甲\u0000乙'])assert.throws(()=>validateReviewerName(value));});
