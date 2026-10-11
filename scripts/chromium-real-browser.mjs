// One fresh Chromium context, actual dev application/API; no route interception.
import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';
import {diagnostics,exceptionInfo,closeResources} from './chromium-real-diagnostics.mjs';
const m=JSON.parse(await readFile('storage/app/chromium-real.json','utf8'));
const result={real_backend:true,attempt:m.attempt,seed_events:1800,network:{latency_ms:40,download_bytes_per_second:1250000,upload_bytes_per_second:1250000},samples:[],checks:{}};
result.diagnostics={};const check=diagnostics(result.diagnostics);
let browser,context,page;
let stage='authentication'; const errors=[],http=[],pending=[];
const loading=()=>page.getByText('Cargando historial…',{exact:true});
const getDoc=()=>page.evaluate(async id=>{const r=await fetch(`/api/documents/${id}`,{headers:{Accept:'application/json'}});if(r.status!==200)throw Error('Document read failed');return (await r.json()).document;},m.document_id);
const readEvents=()=>page.evaluate(async id=>{
 let url=`/api/documents/${id}/timeline?metadata=1`,out=[];
 while(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(r.status!==200)throw Error('Timeline read failed');const p=await r.json();out.push(...p.events);url=p.next_cursor?`/api/documents/${id}/timeline?metadata=1&before_id=${p.before_id}&cursor=${encodeURIComponent(p.next_cursor)}`:null;}
 return out.map(e=>({id:e.id,session:e.writing_session_id,sequence:e.sequence,type:e.event_type}));
},m.document_id);
try {
 check.step('browser.launch');browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 check.step('browser.context');context=await browser.newContext({extraHTTPHeaders:{'X-Chromium-Real-Run':m.run}});
 page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',()=>errors.push('pageerror'));
 page.on('response',r=>{
  const path=new URL(r.url()).pathname;
  if(path.startsWith('/api/')) http.push({method:r.request().method(),operation:path.endsWith('/events')?'events':path.endsWith('/timeline')?'timeline':path.endsWith('/seal')?'seal':path.endsWith('/login')?'login':path.endsWith('/me')?'identity':path.endsWith('/csrf-token')?'csrf':'other',status:r.status()});
 });
 check.step('authentication.form');
 await page.goto('http://app/?lang=es');
 await page.locator('input[name=email]').fill(m.email); await page.locator('input[name=password]').fill('Fictitious12345');
 const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();check.equal('authentication.login_status',(await login).status(),200);
 await check.at('authentication.archive_visible',()=>page.locator('.archive-open').waitFor());check.equal('authentication.single_document',await page.locator('.archive-open').count(),1);
 result.checks.real_login=true;
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Performance.enable');
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1250000,uploadThroughput:1250000});
 result.browser_version=browser.version();
 stage='cold_open';check.step('cold_open.editor_visible');const start=performance.now();await page.locator('.archive-open').click();await page.locator('.ProseMirror').waitFor();
 const sample={opening:'cold',editor_available_ms:Math.round(performance.now()-start)};result.samples.push(sample);
 const completion=loading().waitFor({state:'hidden',timeout:60000}).then(()=>{sample.metrics_complete_ms=Math.round(performance.now()-start);});completion.catch(()=>{});pending.push(completion);
 const windowBefore=await loading().isVisible();
 stage='writing';check.step('writing.insert_marker');const editor=page.locator('.ProseMirror');await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' recorrido real á génesis');
 const windowAfter=await loading().isVisible();result.checks.write_during_load_observed=windowBefore&&windowAfter;
 result.checks.loading_before_typing=windowBefore;result.checks.loading_after_typing=windowAfter;
 stage='save';check.step('save.terminal_response');const saveStart=performance.now();
 // api.ts handles one 419 by refreshing CSRF; await its terminal response.
 const patch=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/documents/${m.document_id}`&&r.request().method()==='PATCH'&&r.status()!==419);
 await page.getByRole('button',{name:'Guardar ahora',exact:true}).click();check.equal('save.patch_status',(await patch).status(),200);
 await check.at('save.confirmed_ui',()=>page.getByText('Todo guardado',{exact:true}).waitFor());result.save_ms=Math.round(performance.now()-saveStart);
 await check.at('cold_open.metrics_complete',()=>completion);check.equal('cold_open.no_partial_metrics',await page.locator('.evidence-list strong').filter({hasText:'Cargando…'}).count(),0);
 const savedHtml=await check.at('save.editor_html',()=>editor.innerHTML());check.ok('save.editor_marker',savedHtml.includes('recorrido real á génesis'));
 const docBefore=await check.at('save.server_document',getDoc);check.ok('save.server_marker',docBefore.content_html.includes('recorrido real á génesis'));
 const eventsBefore=await check.at('save.server_events',readEvents);result.events_before_moviola=eventsBefore.length;check.ok('save.event_count_range',eventsBefore.length>1800&&eventsBefore.length<=2000);check.ok('save.save_event_present',eventsBefore.some(e=>e.type==='save'));
 result.checks.saved_html_on_server=true;result.events_before_moviola=eventsBefore.length;
 stage='moviola';check.step('moviola.open');const writes=[];
 const watch=r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/'))writes.push(r.method());};page.on('request',watch);
 await page.getByRole('button',{name:'Abrir la moviola',exact:false}).click();await page.locator('.replay-paper article[aria-busy=false]').waitFor();
 const slider=page.getByRole('slider');const total=Number(await slider.getAttribute('max'))+1;
 check.equal('moviola.total_matches_server',total,eventsBefore.length);
 result.positions=[];
 for(const position of [0,Math.floor(total/2),total-1]){
  check.step(`moviola.position_${position}.snapshot_ready`);await slider.fill(String(position));await page.locator('.replay-paper article[aria-busy=false]').waitFor();
  check.match(`moviola.position_${position}.label`,await page.locator('.replay-meta').innerText(),new RegExp(`Evento ${position+1} de ${total}`));
  const rows=await page.locator('.event-list button').count();result.last_rail_rows=rows;check.ok(`moviola.position_${position}.rail_limit`,rows<=41);result.positions.push(position);
  if(position===total-1)check.ok('moviola.last_snapshot_marker',(await check.at('moviola.last_snapshot_text',()=>page.locator('.replay-paper article').innerText())).includes('recorrido real á génesis'));
 }
 // Actual playback crosses a remote snapshot block of 32.
 check.step('moviola.playback.block_start');await slider.fill('880');await page.locator('.replay-paper article[aria-busy=false]').waitFor();
 await page.getByRole('combobox',{name:'Velocidad'}).selectOption('16');await page.getByRole('button',{name:'Reproducir',exact:true}).click();
 await check.at('moviola.playback.cross_block',()=>page.waitForFunction(()=>Number(document.querySelector('.transport input').value)>=915,null,{timeout:20000}));
 await page.getByRole('button',{name:'Pausar',exact:true}).click();
 const docAfter=await check.at('moviola.after.server_document',getDoc);const eventsAfter=await check.at('moviola.after.server_events',readEvents);
 check.equal('moviola.draft_html_unchanged',docAfter.content_html,docBefore.content_html);
 check.equal('moviola.updated_at_unchanged',docAfter.updated_at,docBefore.updated_at);
 check.equal('moviola.revision_unchanged',docAfter.revision,docBefore.revision);
 check.deep('moviola.server_events_unchanged',eventsAfter,eventsBefore);
 await check.at('moviola.return_to_editor',()=>page.getByRole('button',{name:'← Volver al documento'}).click());
 check.equal('moviola.editor_html_unchanged',await check.at('moviola.returned_editor_html',()=>editor.innerHTML()),savedHtml);
 check.deep('moviola.no_write_requests',writes,[]);page.off('request',watch);
 result.checks.moviola_no_writes_no_draft_or_event_changes=true;result.moviola_event_count=eventsAfter.length;
 stage='reopen';check.step('reopen.archive');await page.getByRole('button',{name:'← Mis documentos'}).click();await page.locator('.archive-open').waitFor();
 const reopenStart=performance.now();await page.locator('.archive-open').click();await editor.waitFor();
 const reopen={opening:'reopen',editor_available_ms:Math.round(performance.now()-reopenStart)};result.samples.push(reopen);
 await loading().waitFor({state:'hidden',timeout:60000});reopen.metrics_complete_ms=Math.round(performance.now()-reopenStart);
 check.equal('reopen.editor_html_preserved',await editor.innerHTML(),savedHtml);
 const reopened=await check.at('reopen.server_events',readEvents);const ids=new Set(reopened.map(e=>e.id));check.ok('reopen.original_event_ids_preserved',eventsBefore.every(e=>ids.has(e.id)));check.ok('reopen.event_ceiling',reopened.length<=2000);
 result.checks.reopened_text_and_original_events_preserved=true;result.events_after_reopen=reopened.length;
 stage='seal';check.step('seal.create');await page.getByRole('button',{name:'Sellar versión',exact:true}).click();
 const sealed=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/documents/${m.document_id}/seal`&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Certificar versión',exact:true}).click();check.equal('seal.status',(await sealed).status(),201);await check.at('seal.confirmed_ui',()=>page.locator('.certificate-card').waitFor());
 result.checks.real_seal_created=true;
 const perf=await cdp.send('Performance.getMetrics');result.heap_sample_bytes=perf.metrics.find(v=>v.name==='JSHeapUsedSize')?.value;
 check.deep('browser.no_page_errors',errors,[]);check.ok('http.no_5xx_or_throttle',!http.some(r=>r.status>=500||r.status===429));
 result.passed=true;
}catch(e){result.passed=false;result.failed_stage=stage;result.error_type=e?.name??typeof e;result.failure={step:result.diagnostics.step,comparison:e?.code==='ERR_ASSERTION'?result.diagnostics.comparison:null,original_exception:exceptionInfo(e,['Fictitious12345',m.email])};process.exitCode=1;}
finally{
 Object.assign(result,await closeResources(context,browser,pending,['Fictitious12345',m.email]));result.http_responses=http;result.page_errors=errors;
 if(result.secondary_errors.length){result.passed=false;process.exitCode=1;}
 try{await writeFile('.dev-private/chromium-real/browser.json',JSON.stringify(result,null,2),{mode:0o600});}catch(e){result.passed=false;result.report_error=exceptionInfo(e);process.exitCode=1;}
 console.log(JSON.stringify(result));
}
