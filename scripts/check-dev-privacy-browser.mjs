import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile('storage/app/privacy-fixture.json','utf8'));
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext(); const page=await context.newPage();page.setDefaultTimeout(30000);
const base='http://app';const doc=fixture.document_id;const path=`/documents/${doc}`;
async function call(url,body,method='GET') {
 if(method==='PATCH' && url===path) body={...body,revision:(await call(path)).body.document.revision};
 return page.evaluate(async ({url,body,method})=>{
  const meta=document.querySelector('meta[name="csrf-token"]');
  const send=()=>fetch('/api'+url,{method,headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-TOKEN':meta?.content??''},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let response=await send();
  if(response.status===419){const token=await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json();meta.content=token.csrf_token;response=await send();}
  return {status:response.status,body:await response.json()};
 },{url,body,method});
}
async function authenticate(name) {
 for(let attempt=0;attempt<6;attempt++) {
  await page.locator('input[name=email]').fill(fixture.users[name].email);await page.locator('input[name=password]').fill('Fictitious12345');
  const completed=page.waitForResponse(response=>response.url().endsWith('/api/auth/login') && response.status()!==419);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();const response=await completed;
  if(response.status()===429){console.log('Waiting 15s for development login rate limit');await page.waitForTimeout(15000);continue}
  assert.equal(response.status(),200,'Real login status');await page.getByTitle('Cerrar sesión',{exact:true}).waitFor();return;
 }
 throw new Error('Login rate limit did not reset');
}
async function login(name) {await page.goto(base+'/?lang=es');await authenticate(name)}
async function upload() {
 return page.evaluate(async doc=>{
  const token=await (await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json();
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const form=new FormData();form.set('image',new Blob([bytes],{type:'image/png'}),'fixture.png');
  const response=await fetch(`/api/documents/${doc}/images`,{method:'POST',headers:{Accept:'application/json','X-CSRF-TOKEN':token.csrf_token},body:form});
  if(response.status!==201)throw new Error('Image fixture upload failed: '+response.status);return response.json();
 },doc);
}
async function imageStatus(src) {return page.evaluate(async src=>(await fetch(src)).status,src)}
async function logoutServer(){assert.equal((await call('/auth/logout',{},'POST')).status,200)}
try {
 await login('A');
 await page.evaluate(doc=>localStorage.setItem(`veritas:recovery:${doc}`,JSON.stringify({html:'LEGACY A PRIVATE',savedAt:Date.now(),sessionId:'unowned',pending:[]})),doc);
 const firstImage=await upload();
 const firstHtml=`<p>DELIVERED ONLY</p><img src="${firstImage.src}">`;
 const sessions=[crypto.randomUUID(),crypto.randomUUID()];
 for(const session_id of sessions)assert.equal((await call(path+'/events',{session_id,events:[{sequence:1,event_type:'insert',after_html:firstHtml,elapsed_ms:1000}]},'POST')).status,200);
 assert.equal((await call(path,{content_html:firstHtml},'PATCH')).status,200);
 const first=await call(path+'/seal',{},'POST');assert.equal(first.status,201);const v1=first.body.version;
 const delivery=await call('/submissions',{document_version_id:v1.id,recipient_email:fixture.users.B.email},'POST');assert.equal(delivery.status,201);
 const laterImage=await upload();
 const laterHtml=`<p>PRIVATE AFTER</p><img src="${laterImage.src}">`;
 assert.equal((await call(path+'/events',{session_id:sessions[0],events:[{sequence:2,event_type:'insert',after_html:laterHtml,data:'PRIVATE AFTER',elapsed_ms:999999,created_at:'2000-01-01'}]},'POST')).status,200);
 assert.equal((await call(path,{content_html:laterHtml},'PATCH')).status,200);
 const second=await call(path+'/seal',{},'POST');assert.equal(second.status,201);const v2=second.body.version;
 assert.equal((await call('/submissions',{document_version_id:v2.id,recipient_email:fixture.users.D.email},'POST')).status,201);
 // Exercise ingestion from two sessions, save and sealing concurrently on MariaDB.
 const racing=await Promise.all([
  call(path+'/events',{session_id:sessions[0],events:[{sequence:3,event_type:'insert',after_html:'<p>RACE PRIVATE 1</p>',elapsed_ms:1000000}]},'POST'),
  call(path+'/events',{session_id:sessions[1],events:[{sequence:2,event_type:'insert',after_html:'<p>RACE PRIVATE 2</p>',elapsed_ms:1000000}]},'POST'),
  call(path,{content_html:'<p>RACE PRIVATE SAVED</p>'},'PATCH'),
  call(path+'/seal',{},'POST')
 ]);
 for(let index=0;index<racing.length;index++)assert.equal(racing[index].status,index===3?201:200);
 const race=racing[3].body;let bounded=0;
 for(const [session,head] of Object.entries(race.certificate.signed_payload.history_boundary)) {
  const event=(await call(path+'/timeline?event_id='+head.event_id)).body.events[0];
  assert.equal(event.writing_session_id,session);assert.equal(event.sequence,head.sequence);assert.equal(event.event_hash,head.hash);bounded+=head.sequence;
 }
 assert.ok([3,4,5].includes(bounded));assert.equal((await call('/verify/'+race.certificate.certificate_code)).body.valid,true);
 const all=(await call(path+'/timeline?metadata=1')).body;const late=all.events.at(-1).id;
 await logoutServer();await login('B');
 assert.equal((await call('/submissions/'+delivery.body.submission.id)).body.version.snapshot_html,v1.snapshot_html);
 if(fixture.legacy_submission_id) {
  const legacy=await call('/submissions/'+fixture.legacy_submission_id);assert.equal(legacy.status,200);assert.equal(legacy.body.history_available,false);assert.equal(legacy.body.version.snapshot_html,'<p>LEGACY SNAPSHOT</p>');
  assert.equal((await call(path+'/timeline?version_id='+fixture.legacy_version_id)).status,409);assert.equal((await call('/verify/'+fixture.legacy_certificate_code)).body.valid,true);
 }
 assert.equal((await call(path)).status,404);assert.equal((await call(path+'/timeline')).status,404);
 assert.equal(await imageStatus(firstImage.src+'?version_id='+v1.id),200);
 assert.equal(await imageStatus(laterImage.src+'?version_id='+v1.id),404);
 assert.equal(await imageStatus(firstImage.src),404);
 const scope=path+'/timeline?version_id='+v1.id;
 const meta=await call(scope+'&metadata=1&before_id=999999999');assert.equal(meta.status,200);assert.equal(meta.body.total,2);assert.equal(meta.body.sessions.length,2);assert.ok(!JSON.stringify(meta).includes('PRIVATE AFTER'));
 for(const suffix of ['&event_id='+late,'&snapshot_ids[]='+late])assert.equal((await call(scope+suffix)).status,404);
 assert.equal((await call(path+'/timeline?version_id='+v2.id)).status,404);
 const cursor=Buffer.from(JSON.stringify(['1900-01-01',0,0])).toString('base64');assert.equal((await call(scope+'&metadata=1&before_id=999999999&cursor='+encodeURIComponent(cursor))).body.total,2);
 await page.getByRole('button',{name:'Entregas',exact:true}).click();await page.locator(`[data-submission-id="${delivery.body.submission.id}"]`).click();await page.getByText('DELIVERED ONLY',{exact:true}).waitFor();assert.ok(!(await page.locator('body').innerText()).includes('LEGACY A PRIVATE'));assert.match(await page.evaluate(doc=>localStorage.getItem(`veritas:recovery:${doc}`),doc),/LEGACY A PRIVATE/);assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE AFTER'));
 await logoutServer();await login('C');assert.equal(await imageStatus(firstImage.src+'?version_id='+v1.id),404);assert.equal((await call('/submissions/'+delivery.body.submission.id)).status,404);assert.equal((await call(scope)).status,404);
 await logoutServer();await login('D');assert.equal(await imageStatus(laterImage.src+'?version_id='+v2.id),200);assert.equal((await call(path+'/timeline?metadata=1&version_id='+v2.id)).body.total,3);
 for(const cert of [first.body.certificate,second.body.certificate])assert.equal((await call('/verify/'+cert.certificate_code)).body.valid,true);
 // A recovery survives an expired real server session in the same browser context.
 await logoutServer();await login('A');await page.locator('.archive-open').click();const editor=page.locator('.ProseMirror');await editor.waitFor();assert.ok(!(await editor.innerText()).includes('LEGACY A PRIVATE'));await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' RECOVERY A PRIVATE');
 // End only this fictitious server session while the editor still has its local work.
 await logoutServer();await page.getByRole('button',{name:'Guardar ahora',exact:true}).click();await page.locator('input[name=email]').waitFor();
 const prefix=`veritas:recovery:v2:${fixture.users.A.id}:${doc}`;
 const key=await page.evaluate(prefix=>Object.keys(localStorage).find(k=>k.startsWith(prefix)&&localStorage.getItem(k).includes('RECOVERY A PRIVATE')),prefix);
 const retained=await page.evaluate(key=>localStorage.getItem(key),key);assert.match(retained,/RECOVERY A PRIVATE/);
 await authenticate('B');assert.ok(!(await page.locator('body').innerText()).includes('RECOVERY A PRIVATE'));assert.equal(await page.locator('.ProseMirror').count(),0);
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),retained);
 await page.getByTitle('Cerrar sesión',{exact:true}).click();await page.locator('input[name=email]').waitFor();await authenticate('A');await page.locator('.archive-open').click();await page.getByRole('button').filter({hasText:'RECOVERY A PRIVATE'}).first().click();await editor.waitFor();assert.match(await editor.innerText(),/RECOVERY A PRIVATE/);await page.getByRole('button',{name:'Guardar ahora',exact:true}).click();await page.getByText('Todo guardado',{exact:true}).waitFor();
 // Hold a real PHP response from A, then finish it after B has signed in.
 await page.getByRole('button',{name:'← Mis documentos'}).click();await page.locator('.archive-open').waitFor();
 let release;const gate=new Promise(resolve=>release=resolve);let captured;const got=new Promise(resolve=>captured=resolve);
 await page.route('**/api/documents/'+doc,async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();captured();await gate;await route.fulfill({response});});
 await page.locator('.archive-open').click();await got;await page.getByTitle('Cerrar sesión',{exact:true}).click();await page.locator('input[name=email]').waitFor();await authenticate('B');release();await page.waitForTimeout(500);assert.equal(await editor.count(),0);assert.ok(!(await page.locator('body').innerText()).includes('RECOVERY A PRIVATE'));
 console.log(JSON.stringify({real_php_mariadb:true,same_browser_context:true,delayed_real_response:true,users:fixture.users,document_id:doc,versions:[fixture.legacy_version_id,v1.id,v2.id,race.version.id],race_boundary_events:bounded,passed:true}));
} finally {await browser.close()}
