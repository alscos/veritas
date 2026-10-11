// Historical pre-pagination benchmark. Requires the old UI/API checkout.
// Current real-backend measurements: scripts/measure-dev-browser.mjs.
// Synthetic API only: never reads user documents or production configuration.
// Measure real Chromium HTTP transfer at 10 Mbit/s, 40 ms latency.
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const html = `<p>${'El pingüino llegó. génesis '.repeat(150).trimEnd()}</p><p></p><p><mark data-origin="paste">Texto pegado</mark> <mark data-origin="paste-edited">revisión</mark></p>`;
const events = Array.from({ length: 2000 }, (_, index) => ({ writing_session_id: 'synthetic-session', sequence: index + 1, event_type: 'insert', input_type: 'insertText', after_html: `${html}<p>${index + 1}</p>`, elapsed_ms: (index + 1) * 200 }));
const doc = { id: 'synthetic', title: 'Synthetic history', owner_id: 1, content_html: events.at(-1).after_html, content_text: '', word_count: 604, status: 'draft', created_at: '2026-10-10T12:00:00Z', updated_at: '2026-10-10T12:00:00Z', versions: [] };
// Laravel's default JSON representation escapes Unicode and slashes.
const bytes = Buffer.from(JSON.stringify({ events }).replace(/[^\x00-\x7f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).replaceAll('/', '\\/'));
const zipped = gzipSync(bytes, { level: 1 });
let encoding = 'identity';
let expectedMetrics;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'synthetic-api', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return next();
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (path.endsWith('/timeline')) {
      if (encoding === 'gzip') res.setHeader('Content-Encoding', 'gzip');
      res.end(encoding === 'gzip' ? zipped : bytes); return;
    }
    const payload = path === '/api/me' ? { user: { id: 1, name: 'Benchmark', email: 'benchmark@example.test' } }
      : path === '/api/folders' ? { folders: [] }
      : path === '/api/documents' ? { documents: [doc] }
      : path.endsWith('/events') ? { accepted: 1 } : { document: doc };
    req.resume(); res.end(JSON.stringify(payload));
  });
} }] });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (encoding of ['identity', 'gzip']) {
    const samples = [];
    for (let run = 0; run < 3; run++) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?lang=es`);
      await page.locator('.archive-open').waitFor();
      // Warm engine in both variants to isolate the history transfer.
      await page.evaluate(() => import('/resources/js/VeritasEditor.tsx'));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1250000, uploadThroughput: 1250000 });
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/timeline'));
      const start = performance.now();
      await page.locator('.archive-open').click();
      const response = await responsePromise; await response.finished();
      const historyMs = performance.now() - start;
      await page.locator('.ProseMirror').waitFor();
      const openMs = performance.now() - start;
      const actual = (await page.locator('.ProseMirror > p').allTextContents()).join('');
      const expected = await page.evaluate(html => { const el = document.createElement('div'); el.innerHTML = html; return el.textContent; }, doc.content_html);
      assert.equal(actual === expected, true, `Document differs: ${actual.length} vs ${expected.length}`);
      assert.equal(await page.locator('.ProseMirror > p').count(), 4);
      const metrics = await page.locator('.evidence-list strong').allTextContents();
      expectedMetrics ??= metrics; assert.deepEqual(metrics, expectedMetrics);
      await page.getByRole('button', { name: /moviola/i }).click();
      await page.locator('.replay-paper').waitFor();
      assert.equal((await response.body()).equals(bytes), true);
      assert.ok(await page.locator('.event-list button').count() >= 2001);
      assert.match(await page.locator('.replay-paper article').innerText(), /génesis/);
      assert.deepEqual(errors, []);
      samples.push({ history_ms: Math.round(historyMs), open_ms: Math.round(openMs) });
      console.log(JSON.stringify({ encoding, run, ...samples.at(-1) }));
      await page.close();
    }
    console.log(JSON.stringify({ encoding, bytes: encoding === 'gzip' ? zipped.length : bytes.length, samples }));
  }
} finally { await browser.close(); await server.close(); }
