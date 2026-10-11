// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { analyzeHtml, lastRecordedPpm, timingAnalysis } from './writingMetrics';
import type { WritingEvent } from './types';
it('preserves PPM and all timings with metadata in multiple sessions', () => {
 const events: WritingEvent[]=[];
 for (const session of ['a','b','c']) {
  const add=(sequence:number,type:WritingEvent['event_type'],elapsed:number,html:string)=>events.push({writing_session_id:session,sequence,event_type:type,input_type:'insertText',elapsed_ms:elapsed,after_html:html});
  add(1,'start',0,'<p>á</p>'); add(2,'insert',1000,'<p>á génesis</p>');
  add(3,'paste',2000,'<p>á génesis <mark data-origin="paste">externo</mark></p>');
  add(4,'blur',3000,'<p>á génesis</p>'); add(5,'focus',9000,'<p>á génesis</p>');
  add(6,'insert',10000,'<p>á génesis tres cuatro cinco</p>'); add(7,'format',12000,'<p>á génesis tres cuatro cinco</p>');
  add(8,'save',20000,'<p>á génesis tres cuatro cinco</p>');
 }
 const metadata=events.map(({after_html,...event})=>({...event,direct_words:analyzeHtml(after_html ?? "").direct}) as WritingEvent);
 expect(lastRecordedPpm(metadata)).toBe(lastRecordedPpm(events)); expect(lastRecordedPpm(metadata)).toBe(13);
 expect(timingAnalysis(metadata)).toEqual(timingAnalysis(events));
 expect(timingAnalysis(metadata)).toEqual({totalMs:60000,writingMs:9000,revisionMs:9000,pauseMs:24000,pauseCount:3,awayMs:18000});
});
it('processes all 25000 metadata events without truncation',()=>{
 const events=Array.from({length:25000},(_,i)=>({writing_session_id:`s${Math.floor(i/5000)}`,sequence:i%5000+1,event_type:i%5000===0?'start':'insert',input_type:'insertText',elapsed_ms:(i%5000)*200,direct_words:i%5000} as WritingEvent));
 expect(timingAnalysis(events).totalMs).toBe(5*4999*200);
 expect(lastRecordedPpm(events)).toBe(300);
});
