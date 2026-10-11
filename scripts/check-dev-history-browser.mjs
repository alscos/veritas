// Fictitious account only. Chromium uses the real PHP/MariaDB API without interception.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [base='http://app',givenEmail,givenDocumentId] = process.argv.slice(2);
const fixture = givenEmail ? null : JSON.parse(await readFile('storage/app/history-benchmark.json','utf8'));
const email = givenEmail ?? fixture.email, documentId = givenDocumentId ?? fixture.document_id;
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage(); page.setDefaultTimeout(30000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const requestedSnapshots=new Set(); let metadataRequests=0;
page.on('request',r=>{const u=new URL(r.url()); if(u.searchParams.get('metadata')) metadataRequests++; for(const id of u.searchParams.getAll('snapshot_ids[]'))requestedSnapshots.add(id)});
try {
 await page.goto(base+'/?lang=es'); await page.locator('input[name=email]').fill(email); await page.locator('input[name=password]').fill('Fictitious12345');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('.archive-open').waitFor();
 const start=performance.now();await page.locator('.archive-open').click();await page.locator('.ProseMirror').waitFor();const openMs=performance.now()-start;
 const loading=await page.getByText('Cargando historial…',{exact:true}).count(); assert.equal(loading,1,'Editor must mount before history completes');
 const editor=page.locator('.ProseMirror');await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' prueba nueva durante carga');
 await page.getByRole('button',{name:'Guardar ahora',exact:true}).click();await page.getByText('Todo guardado',{exact:true}).waitFor();
 await page.getByText('Cargando historial…',{exact:true}).waitFor({state:'hidden',timeout:120000});
 const completeMs=performance.now()-start;
 const saved=await editor.innerHTML();const metrics=await page.locator('.evidence-list strong').allTextContents();
 assert.ok(Number((await page.locator('.live-title small').innerText()).split(' ')[0])>=25002);
 assert.equal(requestedSnapshots.size,0,'Opening must not request snapshots');
 const getDoc=()=>page.evaluate(async id=>(await (await fetch(`/api/documents/${id}`,{headers:{Accept:'application/json'}})).json()).document,documentId);
 const before=await getDoc();const posts=[];page.on('request',r=>{if(r.method()!=='GET') posts.push(new URL(r.url()).pathname)});
 await page.getByRole('button',{name:'Abrir la moviola',exact:false}).click();await page.locator('.replay-paper').waitFor();
 const range=page.getByRole('slider'); const total=Number(await range.getAttribute('max'))+1;
 assert.ok(total>=25002);
 const positions=[0,12499,total-1];
 for(const index of positions) {
  await range.fill(String(index));await page.locator('.replay-paper article[aria-busy=false]').waitFor();
  assert.match(await page.locator('.replay-meta').innerText(),new RegExp(`Evento ${index+1} de ${total}`));
  assert.ok(await page.locator('.event-list button').count()<=41);
  if(index===total-1)assert.match(await page.locator('.replay-paper article').innerText(),/prueba nueva durante carga/);
 }
 // Exercise sequential playback across a 32-snapshot block boundary.
 await range.fill('12499');await page.locator('.replay-paper article[aria-busy=false]').waitFor();
 await page.getByRole('combobox',{name:'Velocidad'}).selectOption('16');await page.getByRole('button',{name:'Reproducir',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('.transport input').value)>=12540,null,{timeout:30000});
 await page.getByRole('button',{name:'Pausar',exact:true}).click();
 const after=await getDoc();assert.equal(after.content_html,before.content_html);assert.equal(after.updated_at,before.updated_at);
 // Timeline navigation itself emits no writes (flush completed before opening).
 assert.deepEqual(posts,[]);
 await page.getByRole('button',{name:'← Volver al documento'}).click();assert.equal(await editor.innerHTML(),saved);
 assert.deepEqual(await page.locator('.evidence-list strong').allTextContents(),metrics);
 await page.getByRole('button',{name:'← Mis documentos'}).click();await page.locator('.archive-open').click();await editor.waitFor();
 await page.getByText('Cargando historial…',{exact:true}).waitFor({state:'hidden',timeout:120000});assert.equal(await editor.innerHTML(),saved);
 assert.deepEqual((await page.locator('.evidence-list strong').allTextContents()).slice(0,3),metrics.slice(0,3));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');const perf=await cdp.send('Performance.getMetrics');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({real_backend:true,events:25000,open_ms:Math.round(openMs),complete_and_save_ms:Math.round(completeMs),metadataRequests,visited_snapshots:requestedSnapshots.size,rail_rows:41,heap:perf.metrics.find(x=>x.name==='JSHeapUsedSize')?.value,metrics,passed:true}));
} finally {await browser.close()}
