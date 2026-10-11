// Local component regression with fictitious, delayed API responses only.
// No login, PHP, MariaDB, remote URL, real documents or capacity measurement.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = process.cwd();
const fixture = await mkdtemp(join(root, 'timeline-check-'));
const folder = fixture.slice(root.length + 1);
const html = id => `<p>Evento ${id}: El pingüino llegó a Cádiz. ge\u0301nesis</p><p></p><p><mark data-origin="paste">fuente</mark> <mark data-origin="paste-edited">enmienda</mark></p>`;
let server, browser;
try {
  await writeFile(join(fixture, 'index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
  await writeFile(join(fixture, 'entry.tsx'), `
    import { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { Timeline } from '../resources/js/App';
    import '../resources/css/app.css';
    const events = Array.from({length:120}, (_,index) => ({id:index+1,writing_session_id:'fictional',sequence:index+1,event_type:'insert',elapsed_ms:index*200}));
    function Fixture() { const [index,setIndex]=useState(119); const [closed,setClosed]=useState(false);
      return closed ? <p>Vista cerrada</p> : <Timeline events={events} documentId="fictional-document" index={index} setIndex={setIndex} loading={false} historyError={false} onRetryHistory={()=>{}} title="Documento ficticio" onClose={()=>setClosed(true)} />;
    }
    createRoot(document.getElementById('root')!).render(<Fixture />);
  `);
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.INKGROOVE_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.setDefaultTimeout(10000);
  const errors = []; const reads = []; let active = 0, maxConcurrent = 0, failFirstFrame = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    assert.equal(url.pathname, '/api/documents/fictional-document/timeline');
    assert.equal(request.method(), 'GET');
    const ids = url.searchParams.getAll('snapshot_ids[]').map(Number);
    assert.ok(ids.length > 0 && ids.length <= 32);
    reads.push(ids); active++; maxConcurrent = Math.max(maxConcurrent, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 120));
      const fail = failFirstFrame && ids.includes(1);
      if (fail) failFirstFrame = false;
      await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { message: 'Controlled fixture failure' } : { events: ids.map(id => ({id,after_html:html(id)})) }) });
    } finally { active--; }
  });
  await page.goto(`${base}/${folder}/index.html?lang=es`);
  const article = page.locator('.replay-paper article'); const slider = page.getByRole('slider');
  await page.waitForFunction(() => document.querySelector('.replay-paper article')?.textContent.includes('Evento 120:'));
  await page.evaluate(() => {
    window.__blinks = 0;
    const article = document.querySelector('.replay-paper article');
    new MutationObserver(() => { if (!article.textContent.trim() || article.textContent.includes('Cargando instantánea')) window.__blinks++; }).observe(article, { childList: true, subtree: true });
  });
  const original = await article.innerHTML();
  await slider.fill('40');
  await article.locator('..').locator('article[aria-busy=true]').waitFor();
  const during = { html: await article.innerHTML(), label: await page.locator('.replay-meta').innerText() };
  if (process.env.INKGROOVE_TIMELINE_SCREENSHOT) await page.screenshot({ path: process.env.INKGROOVE_TIMELINE_SCREENSHOT });
  await page.waitForFunction(() => document.querySelector('.replay-paper article')?.textContent.includes('Evento 41:'));
  for (const position of [39,38,37,38,39,40]) await slider.fill(String(position));
  for (const position of [70,20,85]) await slider.fill(String(position));
  await page.waitForFunction(() => document.querySelector('.replay-paper article')?.textContent.includes('Evento 86:'));
  const beforeFailure = await article.innerHTML(); failFirstFrame = true;
  await slider.fill('0'); await page.getByRole('alert').waitFor();
  const onFailure = await article.innerHTML();
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.replay-paper article')?.textContent.includes('Evento 1:'));
  assert.equal(await article.innerHTML(), html(1));
  await page.getByRole('button', { name: '← Volver al documento', exact: true }).click();
  await page.getByText('Vista cerrada', { exact: true }).waitFor();
  const blinks = await page.evaluate(() => window.__blinks);
  console.log(JSON.stringify({ real_backend: false, api: 'controlled', events: 120, response_delay_ms: 120, browser: await browser.version(), blinks, max_concurrent_reads: maxConcurrent, reads: reads.length, kept_frame_while_loading: during.html === original, kept_frame_on_failure: onFailure === beforeFailure, non_get_requests: 0, page_errors: errors }));
  assert.equal(during.html, original, 'A pending snapshot must not replace confirmed HTML');
  assert.match(during.label, /Evento 120 de 120/);
  assert.match(during.label, /Cargando evento 41/);
  assert.equal(onFailure, beforeFailure, 'A failed read must not erase the last confirmed frame');
  assert.equal(blinks, 0, 'No blank/loading-text frames while scrubbing');
  assert.equal(maxConcurrent, 1, 'Snapshot reads must be serialized');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); await server?.close(); await rm(fixture, { recursive: true, force: true });
}
