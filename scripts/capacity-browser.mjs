// One Chromium, real development API. Run after HTTP stages, never a browser swarm.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile('storage/app/capacity-fixture.json','utf8'));
const record=fixture.users[29];
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({extraHTTPHeaders:{'X-Capacity-Probe':'1'}});const page=await context.newPage();page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://app/?lang=es');await page.locator('input[name=email]').fill(record.email);await page.locator('input[name=password]').fill('Fictitious12345');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('.archive-open').first().waitFor();
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Network.enable');
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1250000,uploadThroughput:1250000});
 // Use archive card matching title without depending on its outer class.
 const button=page.locator('.archive-open').filter({hasText:'Capacity growing 25000'});
 assert.equal(await button.count(),1,'The 25k fixture must exist');const target=button;
 const start=performance.now();await target.click();await page.locator('.ProseMirror').waitFor();const open=performance.now()-start;
 const editor=page.locator('.ProseMirror');await editor.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' navegador á génesis');
 await page.getByRole('button',{name:'Guardar ahora',exact:true}).click();await page.getByText('Todo guardado',{exact:true}).waitFor();
 await page.getByText('Cargando historial…',{exact:true}).waitFor({state:'hidden'});const complete=performance.now()-start;
 const html=await editor.innerHTML();await page.getByRole('button',{name:'Abrir la moviola',exact:false}).click();
 await page.locator('.replay-paper article[aria-busy=false]').waitFor();const slider=page.getByRole('slider');await slider.fill(await slider.getAttribute('max'));await page.locator('.replay-paper article[aria-busy=false]').waitFor();
 await page.getByRole('button',{name:'← Volver al documento'}).click();assert.equal(await editor.innerHTML(),html);
 await page.getByRole('button',{name:'← Mis documentos'}).click();const reopenStart=performance.now();await target.click();await editor.waitFor();const reopen=performance.now()-reopenStart;
 await page.getByText('Cargando historial…',{exact:true}).waitFor({state:'hidden'});assert.equal(await editor.innerHTML(),html);
 const metrics=await cdp.send('Performance.getMetrics');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({real_backend:true,open_ms:open,complete_and_save_ms:complete,reopen_ms:reopen,heap_sample_bytes:metrics.metrics.find(m=>m.name==='JSHeapUsedSize')?.value,passed:true}));
}finally{await browser.close()}
