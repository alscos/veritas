import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const fixture=JSON.parse(await readFile('storage/app/privacy-fixture.json','utf8'));
const mode=process.argv[2];assert.ok(['seed','verify','edit'].includes(mode));
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();const doc=fixture.document_id;const path='/documents/'+doc;
async function call(url,body,method='GET') {return page.evaluate(async ({url,body,method})=>{const t=await(await fetch('/api/csrf-token',{headers:{Accept:'application/json'}})).json();const r=await fetch('/api'+url,{method,headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-TOKEN':t.csrf_token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};},{url,body,method});}
async function login(name){await page.goto('http://app/?lang=es');for(let i=0;i<6;i++){const r=await call('/auth/login',{email:fixture.users[name].email,password:'Fictitious12345'},'POST');if(r.status===429){await page.waitForTimeout(15000);continue;}assert.equal(r.status,200);return;}throw Error('Login throttle did not reset');}
async function save(html){const current=(await call(path)).body.document;assert.equal((await call(path,{content_html:html,revision:current.revision},'PATCH')).status,200);}
async function upload(){return page.evaluate(async doc=>{const t=await(await fetch('/api/csrf-token')).json();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const f=new FormData();f.set('image',new Blob([bytes],{type:'image/png'}),'fixture.png');const r=await fetch(`/api/documents/${doc}/images`,{method:'POST',headers:{Accept:'application/json','X-CSRF-TOKEN':t.csrf_token},body:f});if(r.status!==201)throw Error('Upload failed');return r.json();},doc);}
async function seal(){const r=await call(path+'/seal',{},'POST');assert.equal(r.status,201);return r.body;}
async function image(src){const result=await page.evaluate(async src=>{const r=await fetch(src);return {status:r.status,bytes:Array.from(new Uint8Array(await r.arrayBuffer()))};},src);return {status:result.status,hash:createHash('sha256').update(Buffer.from(result.bytes)).digest('hex')};}
try{
 await login('A');
 if(mode==='seed'){
  assert.equal((await call('/documents',{title:'Segundo documento Unicode ñ 漢字',content_html:'<p><strong>á é</strong></p><p></p>'},'POST')).status,201);
  const img=await upload();const html=`<p><strong>ENTREGADO ñ é 漢字 😀</strong></p><p></p><img src="${img.src}">`;
  const sessions=[crypto.randomUUID(),crypto.randomUUID()];
  for(const session_id of sessions)assert.equal((await call(path+'/events',{session_id,events:[{sequence:1,event_type:'insert',input_type:'insertText',after_html:html,elapsed_ms:1000}]},'POST')).status,200);
  await save(html);const v1=await seal();const delivery=await call('/submissions',{document_version_id:v1.version.id,recipient_email:fixture.users.B.email},'POST');assert.equal(delivery.status,201);
  const later=await upload();const privateHtml=`<p><em>PRIVADO POSTERIOR á NFD á</em></p><img src="${later.src}">`;
  assert.equal((await call(path+'/events',{session_id:sessions[0],events:[{sequence:2,event_type:'insert',after_html:privateHtml,elapsed_ms:2000}]},'POST')).status,200);
  await save(privateHtml);const v2=await seal();
  const expected={html:(await call(path)).body.document.content_html,v1,v2,delivery:delivery.body.submission,img,later,imageHash:(await image(img.src)).hash,lateId:(await call(path+'/timeline?metadata=1')).body.events.at(-1).id,sessions};
  await writeFile('storage/app/backup-expected.json',JSON.stringify(expected),{mode:0o600});
 }
 const e=JSON.parse(await readFile('storage/app/backup-expected.json','utf8'));
 assert.equal((await call(path)).body.document.content_html,e.html);assert.equal((await image(e.img.src)).hash,e.imageHash);
 for(const v of [e.v1,e.v2])assert.equal((await call('/verify/'+v.certificate.certificate_code)).body.valid,true);
 assert.equal((await call('/folders')).status,200);
 if(mode==='edit'){
  const html=e.html+'<p>NUEVO DESPUÉS DE RESTAURAR ü</p>';await save(html);
  assert.equal((await call(path+'/events',{session_id:crypto.randomUUID(),events:[{sequence:1,event_type:'insert',after_html:html,elapsed_ms:3000}]},'POST')).status,200);
  const v=await seal();assert.equal((await call('/verify/'+v.certificate.certificate_code)).body.valid,true);assert.match((await call(path)).body.document.content_html,/NUEVO DESPUÉS/);
 }
 assert.equal((await call('/auth/logout',{},'POST')).status,200);await login('B');
 assert.equal((await call('/submissions/'+e.delivery.id)).body.version.snapshot_html,e.v1.version.snapshot_html);
 assert.equal((await call(path)).status,404);
 assert.equal((await image(e.img.src+'?version_id='+e.v1.version.id)).hash,e.imageHash);
 assert.equal((await image(e.later.src+'?version_id='+e.v1.version.id)).status,404);
 const scope=path+'/timeline?version_id='+e.v1.version.id;const timeline=await call(scope);assert.equal(timeline.status,200);assert.equal(timeline.body.total,2);assert.ok(!JSON.stringify(timeline).includes('PRIVADO POSTERIOR'));
 assert.equal((await call(scope+'&event_id='+e.lateId)).status,404);assert.equal((await call(path+'/timeline?version_id='+e.v2.version.id)).status,404);
 console.log(JSON.stringify({mode,real_php_mariadb:true,unicode_images_versions_privacy:true,passed:true}));
}finally{await browser.close()}
