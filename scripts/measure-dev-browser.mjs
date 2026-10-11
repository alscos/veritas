// Real dev backend; no route interception, API stubs or user documents.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [base='http://app', givenEmail, mode = 'progressive'] = process.argv.slice(2);
const email = givenEmail ?? JSON.parse(await readFile('storage/app/history-benchmark.json','utf8')).email;
const browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 for (let run=0;run<3;run++) {
  const page=await browser.newPage(); page.setDefaultTimeout(20000); page.on('response',r=>{if(r.status()>=400) console.log('HTTP',r.status(),new URL(r.url()).pathname)}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?lang=es');
  await page.locator('input[name=email]').fill(email); await page.locator('input[name=password]').fill('Fictitious12345');
  await page.getByRole('button',{name:'Entrar',exact:true}).click(); await page.locator('.archive-open').waitFor();
  const cdp=await page.context().newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1250000,uploadThroughput:1250000});
  for (const opening of ['first','reopen']) {
   let bytes=0; const transferred=e=>{bytes+=e.encodedDataLength}; cdp.on('Network.loadingFinished',transferred);
   const start=performance.now(); await page.locator('.archive-open').click(); await page.locator('.ProseMirror').waitFor();
   const openMs=performance.now()-start;
   if (mode!=='baseline') await page.getByText('Cargando historial…',{exact:true}).waitFor({state:'hidden',timeout:120000});
   const metrics=await page.locator('.evidence-list strong').allTextContents();
   const perf=await cdp.send('Performance.getMetrics');
   console.log(JSON.stringify({mode,run,opening,open_ms:Math.round(openMs),complete_ms:Math.round(performance.now()-start),bytes,heap:perf.metrics.find(x=>x.name==='JSHeapUsedSize')?.value,metrics}));
   cdp.off('Network.loadingFinished',transferred);
   await page.getByRole('button',{name:'Abrir la moviola',exact:false}).click(); await page.locator('.replay-paper').waitFor();
   if(mode==='baseline') assert.ok(await page.locator('.event-list button').count()>=2001);
   await page.getByRole('button',{name:'← Volver al documento'}).click();
   await page.getByRole('button',{name:'← Mis documentos'}).click(); await page.locator('.archive-open').waitFor();
  }
  assert.deepEqual(errors,[]); await page.close();
 }
} finally {await browser.close();}
