// Native Node tests; importing this file cannot launch Chromium or access fixtures.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnostics,summary,exceptionInfo,closeResources} from './chromium-real-diagnostics.mjs';

test('failed numeric assertion records named exact observed/expected and original exception',()=>{
 const state={};const check=diagnostics(state);let error;
 try{check.equal('moviola.revision_unchanged',8,7);}catch(e){error=e;}
 assert.equal(error.code,'ERR_ASSERTION');assert.ok(error.message.startsWith('moviola.revision_unchanged'));
 assert.deepEqual(state.comparison,{id:'moviola.revision_unchanged',operator:'strictEqual',observed:8,expected:7});
 assert.equal(exceptionInfo(error).operator,'strictEqual');assert.equal(exceptionInfo(error).message,'moviola.revision_unchanged');assert.equal(state.passed_assertions.length,0);
});

test('HTML comparison remains exact while only bounded hashes and first differing offset are logged',()=>{
 const state={};const check=diagnostics(state);
 const expected='<p>á génesis</p>',observed='<p>a génesis</p>';
 let error;try{check.equal('moviola.editor_html_unchanged',observed,expected);}catch(e){error=e;}
 assert.ok(error);assert.ok(!JSON.stringify(exceptionInfo(error)).includes('<p>'));
 assert.equal(state.comparison.first_difference_utf16,3);assert.notEqual(state.comparison.expected.sha256,state.comparison.observed.sha256);
 assert.ok(!JSON.stringify(state).includes('<p>'));assert.ok(JSON.stringify(state).length<1000);
});

test('ordered event comparison rejects omissions and reordering',()=>{
 const state={};const check=diagnostics(state);const expected=[{id:1,sequence:1},{id:2,sequence:2}];
 assert.throws(()=>check.deep('moviola.server_events_unchanged',[expected[1],expected[0]],expected));
 assert.equal(state.comparison.first_difference_index,0);
 assert.equal(state.comparison.observed.length,2);assert.throws(()=>check.deep('moviola.server_events_unchanged',[expected[0]],expected));
 assert.equal(state.comparison.observed.length,1);assert.equal(state.comparison.expected.length,2);assert.equal(state.comparison.first_difference_index,1);
});

test('passing checks retain their identity; operation failure clears stale comparison',async()=>{
 const state={};const check=diagnostics(state);check.ok('save.marker',true);check.match('moviola.label','Evento 1 de 10',/Evento 1 de 10/);
 const original=new Error('operation failed');await assert.rejects(check.at('moviola.return_to_editor',()=>Promise.reject(original)),e=>e===original);
 assert.equal(state.step,'moviola.return_to_editor');assert.equal(state.comparison,null);assert.deepEqual(state.passed_assertions,['save.marker','moviola.label']);
});

test('exception diagnostic preserves code and bounded frames but redacts credentials and headers',()=>{
 const error=new Error('password=secret\nCookie: sid=value\nBearer example\nfixture@example.test');error.code='SAMPLE';
 error.stack='Error\n    at function (/workspace/scripts/example.mjs:42:1)\n'+('    at secret\n'.repeat(20));
 const info=exceptionInfo(error,['secret','fixture@example.test']);const json=JSON.stringify(info);
 assert.equal(info.code,'SAMPLE');assert.ok(!json.includes('sid=value'));assert.ok(!json.includes('secret'));assert.ok(!json.includes('fixture@example.test'));assert.ok(!json.includes('Bearer example'));assert.equal(info.stack_frames.length,6);
 assert.ok(summary('x'.repeat(100000)).bytes===100000);
});

test('context close failure still closes browser and releases pending operations',async()=>{
 const calls=[];let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const state=await closeResources({async close(){calls.push('context');throw Error('context');}},{async close(){calls.push('browser');finish();}},[pending]);
 assert.deepEqual(calls,['context','browser']);assert.equal(state.browser_closed,true);assert.equal(state.secondary_errors[0].step,'close_context');
});

test('browser close failure is explicit, separate from the original functional failure',async()=>{
 const original={step:'moviola.editor_html_unchanged'};
 const state=await closeResources(undefined,{async close(){throw Error('browser');}},[new Promise(()=>{})]);
 assert.equal(state.browser_closed,false);assert.equal(state.secondary_errors[0].step,'close_browser');assert.deepEqual(original,{step:'moviola.editor_html_unchanged'});
});

test('failed launch without browser is a confirmed absence, not an unclosed writer',async()=>{
 const state=await closeResources(undefined,undefined);assert.equal(state.browser_closed,true);assert.deepEqual(state.secondary_errors,[]);
});
