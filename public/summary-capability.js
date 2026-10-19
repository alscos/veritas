/* No storage, third parties, HTML injection or telemetry. Secret lives only during one request. */
(() => {
  let fragment = location.hash;
  history.replaceState(null, '', location.pathname);
  let token = new URLSearchParams(fragment.slice(1)).get('token'); fragment = '';
  const el = id => document.getElementById(id);
  const text = {
    es: ['Resumen compartido', 'Solo la versión sellada. Procedencia registrada no prueba autoría humana; no se firma el PDF. V2: cobertura limitada, complete=false; no acredita todas las sesiones originales. Tiempos, pausas y ritmos históricos no disponibles. El enlace puede reenviarse; revocar no retira capturas. La recarga requiere abrir otra vez el enlace recibido.', 'Cargando…', 'Enlace no disponible. Abre de nuevo el enlace recibido.', 'No disponible', 'Versión', 'Sellada', 'Cobertura', 'Palabras directas', 'Pegadas', 'Reelaboradas', 'Total'],
    en: ['Shared summary', 'Only the sealed version. Recorded provenance does not prove human authorship; the PDF itself is not signed. V2: limited coverage, complete=false; the original session set is not independently proven. Historical times, pauses and rates are unavailable. Links can be forwarded; revocation cannot recall screenshots. Reloading requires reopening the received link.', 'Loading…', 'Link unavailable. Reopen the received link.', 'Unavailable', 'Version', 'Sealed', 'Coverage', 'Direct words', 'Pasted', 'Edited', 'Total']
  };
  const language = el('language'); language.value = document.documentElement.lang === 'en' ? 'en' : 'es';
  let result = null, pending = true, active = true;
  const controller = new AbortController();
  function render() {
    const t = text[language.value]; document.documentElement.lang = language.value;
    el('heading').textContent = t[0]; el('notice').textContent = t[1];
    el('status').textContent = pending ? t[2] : result ? '' : t[3];
    el('summary').replaceChildren(); if (!result) return;
    const unavailable = t[4], values = [result.version.number, result.version.sealed_at,
      result.coverage.status + ' / complete=' + result.coverage.complete,
      ...['direct','pasted','edited','total'].map(k => result.counts.value?.[k] ?? unavailable)];
    values.forEach((v,i) => {const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=t[i+5];dd.textContent=String(v ?? unavailable);el('summary').append(dt,dd);});
  }
  language.addEventListener('change', render); render();
  async function load() {
    try {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token ?? '')) throw Error();
      const body = JSON.stringify({capability:token}); token = null;
      const r = await fetch('/process-summary/query', {signal:controller.signal, method:'POST', credentials:'same-origin', cache:'no-store', referrerPolicy:'no-referrer', headers:{'Content-Type':'application/json','Accept':'application/json','X-CSRF-TOKEN':document.querySelector('meta[name="csrf-token"]').content},body});
      if (!r.ok) throw Error(); const received=await r.json(); if (active) result=received;
    } catch { result=null; } finally {token=null;pending=false;if(active)render();}
  }
  addEventListener('pagehide', () => {active=false;controller.abort();token=null; result=null; el('summary').replaceChildren();});
  load();
})();
