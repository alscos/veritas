import { describe, it, expect } from 'vitest';
import { mergeHistory, historyWindow } from './history';
import type { WritingEvent } from './types';
const event = (session: string, sequence: number): WritingEvent => ({ writing_session_id: session, sequence, event_type: 'insert', after_html: '<p>fixture</p>', elapsed_ms: sequence * 200 });
describe('progressive history', () => {
  it('retains edits while several sessions arrive and deduplicates retries', () => {
    const history = Array.from({length:25000}, (_, i) => event(`session-${Math.floor(i/5000)}`, i%5000+1));
    const local = [event('session-4',5000),event('live',1),event('live',2)];
    let loaded: WritingEvent[] = [];
    for(let i=0;i<history.length;i+=1000) loaded = mergeHistory(loaded,history.slice(i,i+1000));
    expect(mergeHistory(loaded,local)).toEqual([...history,...local.slice(1)]);
    expect(mergeHistory(loaded,history)).toEqual(history);
    expect(mergeHistory([], [local[1], local[1], local[2]])).toEqual(local.slice(1));
  });
  it('bounds rendering at the beginning, middle and end', () => {
    for(const index of [0,12500,24999]) {
      const {start,end}=historyWindow(index,25000);
      expect(end-start).toBeLessThanOrEqual(41);
      expect(index).toBeGreaterThanOrEqual(start); expect(index).toBeLessThan(end);
    }
  });
});
