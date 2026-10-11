// Pure diagnostics: no Playwright, network, credentials or fixture access.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export function summary(value) {
 if (value===undefined) return {type:'undefined'};
 if (value===null || typeof value==='boolean' || typeof value==='number') return value;
 const serialized=typeof value==='string'?value:JSON.stringify(value);
 return {type:Array.isArray(value)?'array':typeof value,length:typeof value==='string'||Array.isArray(value)?value.length:undefined,bytes:Buffer.byteLength(serialized),sha256:createHash('sha256').update(serialized).digest('hex')};
}

export function exceptionInfo(error,secrets=[]) {
 const redact=value=>{
  let text=String(value??'');
  for(const secret of secrets.filter(Boolean)) text=text.split(secret).join('[redacted]');
  text=text.replace(/((?:password|cookie|authorization|csrf[-_]?token|signing[-_]?key)\s*[:=]\s*)[^\r\n]+/gi,'$1[redacted]');
  text=text.replace(/Bearer\s+[^\s]+/gi,'Bearer [redacted]');
  return text.slice(0,1200);
 };
 // Node 22 appends actual/expected even with a custom assertion message.
 // Preserve its identity/code, first line and digest; never publish expanded HTML.
 const assertion=error?.code==='ERR_ASSERTION';const originalMessage=String(error?.message??'');
 return {name:redact(error?.name),code:redact(error?.code),operator:redact(error?.operator),message:redact(assertion?originalMessage.split('\n')[0]:originalMessage),message_first_line_only:assertion,message_summary:assertion?summary(originalMessage):undefined,stack_frames:String(error?.stack??'').split('\n').filter(line=>/^\s+at /.test(line)).slice(0,6).map(redact)};
}

export function diagnostics(target) {
 target.step='startup';target.comparison=null;target.passed_assertions=[];
 const step=id=>{target.step=id;target.comparison=null;};
 const compare=(id,operator,observed,expected,run)=>{
  step(id);target.comparison={id,operator,observed:summary(observed),expected:summary(expected)};
  if(typeof observed==='string' && typeof expected==='string' && observed!==expected){
   let index=0;while(index<Math.min(observed.length,expected.length)&&observed[index]===expected[index])index++;
   target.comparison.first_difference_utf16=index;
  }
  if(Array.isArray(observed)&&Array.isArray(expected)){
   for(let index=0;index<Math.max(observed.length,expected.length);index++){
    if(!isDeepStrictEqual(observed[index],expected[index])){target.comparison.first_difference_index=index;break;}
   }
  }
  run();target.passed_assertions.push(id);
 };
 return {
  step,
  async at(id,operation){step(id);return operation();},
  equal(id,observed,expected){compare(id,'strictEqual',observed,expected,()=>assert.equal(observed,expected,id));},
  deep(id,observed,expected){compare(id,'deepStrictEqual',observed,expected,()=>assert.deepEqual(observed,expected,id));},
  ok(id,observed){compare(id,'ok',observed,true,()=>assert.ok(observed,id));},
  match(id,observed,expected){compare(id,'match',observed,expected.source,()=>assert.match(observed,expected,id));},
 };
}

export async function closeResources(context,browser,pending=[],secrets=[]) {
 const state={browser_closed:false,secondary_errors:[]};
 try{if(context)await context.close();}catch(error){state.secondary_errors.push({step:'close_context',error:exceptionInfo(error,secrets)});}
 try{if(browser)await browser.close();state.browser_closed=true;}catch(error){state.secondary_errors.push({step:'close_browser',error:exceptionInfo(error,secrets)});}
 // Close first: waiting for an unresolved page operation must not keep a writer alive.
 if(state.browser_closed)await Promise.allSettled(pending);
 else for(const operation of pending)Promise.resolve(operation).catch(()=>{});
 return state;
}
