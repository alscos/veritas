// Real Apache/PHP/MariaDB. Only the lost response is intercepted AFTER real acceptance.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const fixture=JSON.parse(await readFile('storage/app/privacy-fixture.json','utf8'));
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext();const a=await context.newPage();const path='/documents/'+fixture.document_id;
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));a.on('pageerror',e=>errors.push(e.message));
async function call(page,url,body,method='GET') {
 return page.evaluate(async ({url,body,method})=>{
  const meta=document.querySelector('meta[name="csrf-token"]');
  const send=()=>fetch('/api'+url,{method,headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-TOKEN':meta?.content??''},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let response=await send();
  if(response.status===419){const token=await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json();meta.content=token.csrf_token;response=await send();}
  return {status:response.status,body:await response.json()};
 },{url,body,method});
}
async function open(page) {
 await page.goto('http://app/?lang=es');await page.locator('.archive-open').click();
 await page.locator('.ProseMirror').or(page.getByText('Copias locales pendientes',{exact:true})).first().waitFor();
 if(await page.getByText('Copias locales pendientes',{exact:true}).isVisible()) await page.getByRole('button',{name:'Consultar estado del servidor',exact:true}).click();
 await page.locator('.ProseMirror').waitFor();
}
async function type(page,text) {await page.locator('.ProseMirror').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(text)}
async function copies(page) {return page.evaluate(({id,user})=>Object.keys(localStorage).filter(k=>k.startsWith(`veritas:recovery:v2:${user}:${id}`)).map(k=>({key:k,...JSON.parse(localStorage.getItem(k))})),{id:fixture.document_id,user:fixture.users.A.id})}
try {
 await a.goto('http://app/?lang=es');await a.locator('input[name=email]').fill(fixture.users.A.email);await a.locator('input[name=password]').fill('Fictitious12345');await a.getByRole('button',{name:'Entrar',exact:true}).click();await a.locator('.archive-open').waitFor();
 const revision=(await call(a,path)).body.document.revision;
 const race=await Promise.all(['FIRST','SECOND'].map(text=>call(a,path,{revision,content_html:`<p>${text}</p>`},'PATCH')));
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal((await call(a,path)).body.document.revision,revision+1);
 console.log('PASS real simultaneous CAS: exactly one writer accepted');
 // A lost response after real acceptance; exact retry and mismatching sequence.
 const batch={session_id:randomUUID(),events:[{sequence:1,event_type:'insert',after_html:'<p>LOST RESPONSE á á</p>',data:'á á',elapsed_ms:10}]};
 let lost=false;
 await a.route('**/api'+path+'/events',async route=>{if(route.request().postDataJSON().session_id===batch.session_id && !lost){const accepted=await route.fetch();assert.equal(accepted.status(),200);lost=true;await route.abort('failed')}else await route.continue()});
 await assert.rejects(call(a,path+'/events',batch,'POST'));assert.ok(lost);
 await a.unroute('**/api'+path+'/events');
 assert.equal((await call(a,path+'/events',batch,'POST')).body.accepted,0);
 assert.equal((await call(a,path+'/events',{...batch,events:[{...batch.events[0],data:'different'}]},'POST')).status,409);
 const timeline=(await call(a,path+'/timeline')).body.events.filter(e=>e.writing_session_id===batch.session_id);assert.equal(timeline.length,1);
 console.log('PASS real accepted batch / lost response / exact retry / mismatch');
 await open(a);const b=await context.newPage();await open(b);
 await context.setOffline(true);await type(a,' TAB A OFFLINE');await type(b,' TAB B OFFLINE');await a.waitForTimeout(1800);
 let retained=await copies(a);assert.ok(retained.some(r=>r.html.includes('TAB A OFFLINE')&&r.pending.length));assert.ok(retained.some(r=>r.html.includes('TAB B OFFLINE')&&r.pending.length));assert.equal(new Set(retained.map(r=>r.key)).size,retained.length);
 await context.setOffline(false);await a.getByRole('button',{name:'Guardar ahora',exact:true}).click();await a.getByText('Todo guardado',{exact:true}).waitFor();
 await b.getByRole('button',{name:'Guardar ahora',exact:true}).click();await b.getByText('Conflicto · copia local conservada',{exact:true}).waitFor();
 const remote=(await call(a,path)).body.document;assert.match(remote.content_html,/TAB A OFFLINE/);assert.doesNotMatch(remote.content_html,/TAB B OFFLINE/);
 const currentRevision=remote.revision;await b.waitForTimeout(3000);assert.equal((await call(a,path)).body.document.revision,currentRevision);
 await b.getByRole('button',{name:'Consultar estado del servidor',exact:true}).click();await b.getByText('Revisión del servidor',{exact:false}).waitFor();assert.match(await b.locator('.ProseMirror').innerText(),/TAB B OFFLINE/);
 const downloadReady=b.waitForEvent('download');await b.getByRole('button',{name:'Conservar borrador en un archivo',exact:true}).click();const download=await downloadReady;const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.match(exported.html,/TAB B OFFLINE/);assert.ok(exported.pending.length);assert.ok(exported.baseRevision<currentRevision);assert.equal(exported.ownerId,fixture.users.A.id);await download.delete();
 await b.getByRole('button',{name:'English',exact:true}).click();await b.getByText('Conflict · local copy retained',{exact:true}).waitFor();
 await b.goto('http://app/?lang=es');await b.locator('.archive-open').click();await b.getByRole('button').filter({hasText:'TAB B OFFLINE'}).first().click();await b.locator('.ProseMirror').waitFor();await b.getByRole('button',{name:'Guardar ahora',exact:true}).click();await b.getByText('Conflicto · copia local conservada',{exact:true}).waitFor();assert.equal((await call(a,path)).body.document.revision,currentRevision);
 console.log('PASS two distinct offline tabs, reconnect, conflict ES/EN, reopen stale recovery without overwrite');
 // New unsaved work on the current revision survives reopening and can then save.
 await a.close();await b.close();const c=await context.newPage();await open(c);
 await context.setOffline(true);await type(c,' REOPEN SAME REVISION');for(let i=0;i<260;i++) await c.keyboard.insertText('x');assert.ok((await copies(c)).some(r=>r.html.includes('REOPEN SAME REVISION')&&r.pending.length>250));await c.waitForTimeout(1600);await context.setOffline(false);
 await c.reload();await c.locator('.archive-open').click();await c.getByRole('button').filter({hasText:'REOPEN SAME REVISION'}).first().click();await c.locator('.ProseMirror').waitFor();await c.getByRole('button',{name:'Guardar ahora',exact:true}).click();await c.getByText('Todo guardado',{exact:true}).waitFor();assert.match((await call(c,path)).body.document.content_html,/REOPEN SAME REVISION/);
 assert.ok((await copies(c)).some(r=>r.html.includes('TAB B OFFLINE')),'other tab conflict recovery remains');
 console.log('PASS offline work + >250 events / reopen same revision / ordered chunked save');
 let lostUi=false;let dropped;
 await c.route('**/api'+path+'/events',async route=>{
  const body=route.request().postDataJSON();
  if(!lostUi && body.events.some(e=>e.data?.includes('UI LOST RESPONSE'))){
   const accepted=await route.fetch();assert.equal(accepted.status(),200);dropped=body;lostUi=true;await route.abort('failed');
  } else await route.continue();
 });
 await type(c,' UI LOST RESPONSE');await c.getByText('Error al guardar · copia local conservada',{exact:true}).waitFor();assert.ok(lostUi);
 const queued=await copies(c);assert.ok(queued.some(r=>r.pending.some(e=>e.data?.includes('UI LOST RESPONSE'))));
 await c.unroute('**/api'+path+'/events');await c.getByRole('button',{name:'Guardar ahora',exact:true}).click();await c.getByText('Todo guardado',{exact:true}).waitFor();
 const needle=dropped.events.find(e=>e.data?.includes('UI LOST RESPONSE'));
 // Fetch precisely this session through metadata pagination, not a truncated first page.
 let cursor=null,watermark,seen=[];
 do {const params=new URLSearchParams({metadata:'1'});if(cursor){params.set('cursor',cursor);params.set('before_id',String(watermark))}const result=await call(c,path+'/timeline?'+params);assert.equal(result.status,200);seen.push(...result.body.events);cursor=result.body.next_cursor;watermark=result.body.before_id} while(cursor);
 assert.equal(seen.filter(e=>e.writing_session_id===dropped.session_id&&e.sequence===needle.sequence).length,1);
 assert.match((await call(c,path)).body.document.content_html,/UI LOST RESPONSE/);
 assert.deepEqual(errors,[]);console.log('PASS UI retains accepted batch after lost response and retries without duplicates; no page errors');
} finally {await browser.close()}
