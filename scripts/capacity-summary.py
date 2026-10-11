"""Sanitized aggregates only. Never reads cookie/expected-state files or SQL rows."""
import argparse,collections,gzip,json,math
from pathlib import Path

def quantile(xs,q):
    xs=sorted(xs);return round(xs[max(0,math.ceil(len(xs)*q)-1)],2) if xs else None

def main():
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);parser.add_argument('--sql',type=Path);a=parser.parse_args()
    output={'profiles':{},'storage':[]}
    for name in ['http-preparation-failed','http-csrf-failed','http-normal','http-30','http-long','browser','audit']:
        file=a.directory/(name+'.json')
        if not file.exists():continue
        p=json.loads(file.read_text());samples=p.get('samples',p.get('host',[]));rows=p.get('requests',[])
        record={'stop':p.get('stop',[]),'levels':p.get('levels',[]),'groups':{}}
        for phase,kind in sorted({(r['phase'],r['kind']) for r in rows}):
            rs=[r for r in rows if r['phase']==phase and r['kind']==kind]
            record['groups'][phase+'/'+kind]={'count':len(rs),'p50_ms':quantile([r['ms'] for r in rs],.5),'p95_ms':quantile([r['ms'] for r in rs],.95),'max_ms':quantile([r['ms'] for r in rs],1),'queue_p95_ms':quantile([r['queue_ms'] for r in rs],.95),'status':dict(collections.Counter(r['status'] for r in rs)),'wire_bytes':sum(r['bytes'] for r in rs)}
        if samples:
            record['resources']={'samples':len(samples),'available_min_mib':min(s['available_kib'] for s in samples)/1024,'swap_min_mib':min(s['swap_used_kib'] for s in samples)/1024,'swap_max_mib':max(s['swap_used_kib'] for s in samples)/1024,'existing_health_max_ms':max(s['existing_health'][1] for s in samples),'existing_health_failures':sum(not s['existing_health'][0] for s in samples),'dev_health_failures':sum(not s['dev_health'][0] for s in samples),'generator_peak_mib':max(s['generator_maxrss_kib'] for s in samples)/1024,'span_seconds':samples[-1]['time']-samples[0]['time']}
            generator_cpu=[100*(b['generator_cpu_seconds']-a['generator_cpu_seconds'])/(b['time']-a['time']) for a,b in zip(samples,samples[1:]) if 'generator_cpu_seconds' in a and 'generator_cpu_seconds' in b]
            if generator_cpu:record['resources']['generator_peak_cpu_percent']=max(generator_cpu)
            for component in ['inkgroove-dev-app','inkgroove-dev-db']:
                record['resources'][component]={'peak_sampled_rss_mib':max(s[component]['rss_kib'] for s in samples)/1024,'peak_sum_process_hwm_mib':max(s[component]['sum_process_hwm_kib'] for s in samples)/1024,'peak_cpu_percent':max(s[component]['cpu_percent'] for s in samples)}
                pss=[s[component].get('pss_kib') for s in samples if s[component].get('pss_kib') is not None]
                if pss:record['resources'][component]['peak_sampled_pss_mib']=max(pss)/1024
        if 'runner' in p and p['runner']:record['browser_runner_peak_rss_mib']=max(r['rss_kib'] for r in p['runner'])/1024
        if 'runner' in p and p['runner']:
            pss=[r.get('pss_kib') for r in p['runner'] if r.get('pss_kib') is not None]
            if pss:record['browser_runner_peak_pss_mib']=max(pss)/1024
        if 'checks' in p:record['checks']=p['checks']
        output['profiles'][name]=record
    p=json.loads((a.directory/'storage.json').read_text())
    for r in p['storage']:
        table=next(t for t in r['tables'] if t['TABLE_NAME']=='writing_events')
        physical=r['physical'];schema=int(physical[0].split()[0])*1024;root=int(physical[-1].split()[0])*1024
        if len(physical)>2:root+=schema # Original du run excluded the already-counted schema from its second argument.
        active=next((d for d in r['documents'] if d['document']==r.get('active_document')),None)
        output['storage'].append({'label':r['label'],'active':{k:active[k] for k in ['events','snapshot_bytes','live_bytes','revision']} if active else None,'all_fixture_snapshot_bytes':sum(d['snapshot_bytes'] for d in r['documents']),'all_fixture_events':sum(d['events'] for d in r['documents']),'events_data_bytes':int(table['DATA_LENGTH']),'events_index_bytes':int(table['INDEX_LENGTH']),'events_free_bytes':int(table['DATA_FREE']),'physical_schema_bytes':schema,'physical_mysql_bytes':root,'images_bytes':r['images_bytes'],'ingestion_seconds':r.get('ingestion_seconds')})
    # Storage resources and operation quantiles are calculated with the same code as the HTTP profiles.
    rs=p['requests'];output['storage_http']={phase:{'count':len(items),'p50_ms':quantile([r['ms'] for r in items],.5),'p95_ms':quantile([r['ms'] for r in items],.95),'status':dict(collections.Counter(r['status'] for r in items))} for phase in sorted({r['phase'] for r in rs}) for items in [[r for r in rs if r['phase']==phase]]}
    ss=p['samples'];output['storage_resources']={'available_min_mib':min(s['available_kib'] for s in ss)/1024,'app_peak_rss_mib':max(s['inkgroove-dev-app']['rss_kib'] for s in ss)/1024,'db_peak_rss_mib':max(s['inkgroove-dev-db']['rss_kib'] for s in ss)/1024,'generator_peak_rss_mib':max(s['generator_maxrss_kib'] for s in ss)/1024,'app_peak_cpu_percent':max(s['inkgroove-dev-app']['cpu_percent'] for s in ss),'db_peak_cpu_percent':max(s['inkgroove-dev-db']['cpu_percent'] for s in ss),'span_seconds':ss[-1]['time']-ss[0]['time'],'stop':p['stop']}
    probe=a.directory/'php.jsonl'
    if probe.exists():
        rows=[json.loads(line) for line in probe.read_text().splitlines()]
        output['php']={kind:{'samples':len(rs),'peak_allocated_bytes':max(r['allocated_peak'] for r in rs),'peak_used_bytes':max(r['used_peak'] for r in rs)} for kind in sorted({r['kind'] for r in rows}) for rs in [[r for r in rows if r['kind']==kind and r['status'] in (200,201)]] if rs}
    if a.sql:
        size=0
        with gzip.open(a.sql,'rb') as source:
            while True:
                block=source.read(1024*1024)
                if not block:break
                size+=len(block)
        output['sql_sample']={'uncompressed_bytes':size,'gzip_bytes':a.sql.stat().st_size,'level':1,'scope':'fixture rows only, not an installation backup'}
    print(json.dumps(output,indent=2))
if __name__=='__main__':main()
