"""Bounded HTTP load against inkgroove-dev only; run on Alpine host, stdlib.
No credentials/tokens in results. Private manifest and cookies remain in memory.
"""
import concurrent.futures as futures
import collections, gzip, http.cookiejar, json, math, os, resource, subprocess
import threading, time, sys, urllib.request, urllib.error, urllib.parse, uuid
from pathlib import Path
BASE='http://127.0.0.1:8083'
STOP=threading.Event(); REASON=[]; LOCK=threading.Lock(); SAMPLES=[]; ROWS=[]
OUT=Path('/opt/veritas-dev/.dev-private/capacity-results')

def docker(*args):
    return subprocess.check_output(['docker',*args],text=True,timeout=10)

def percentile(values,q):
    values=sorted(values)
    return round(values[max(0,math.ceil(len(values)*q)-1)],2) if values else None

def halt(reason):
    with LOCK:
        if not REASON: REASON.append(reason)
    STOP.set()

def health(port):
    start=time.monotonic()
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/up',timeout=3) as r: ok=r.status==200
    except Exception: ok=False
    return ok,round((time.monotonic()-start)*1000,2)

def processes(name):
    # docker stats reports zero memory here. Read each host PID's procfs instead.
    lines=docker('top',name,'-eo','pid,comm').splitlines()[1:]
    rss=hwm=ticks=pss=private=0; entries=[]; pss_available=True
    for line in lines:
        pid,comm=line.strip().split(None,1)
        try:
            status=Path('/proc/'+pid+'/status').read_text()
            values={a:b.strip() for a,b in (l.split(':',1) for l in status.splitlines() if ':' in l)}
            r=int(values.get('VmRSS','0 kB').split()[0]); h=int(values.get('VmHWM','0 kB').split()[0])
            stat=Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split(); t=int(stat[11])+int(stat[12])
            try:
                smaps={a:int(b.split()[0]) for a,b in (l.split(':',1) for l in Path('/proc/'+pid+'/smaps_rollup').read_text().splitlines()[1:] if ':' in l)}
                pss+=smaps.get('Pss',0);private+=smaps.get('Private_Clean',0)+smaps.get('Private_Dirty',0)
            except (FileNotFoundError,PermissionError):pss_available=False
            rss+=r;hwm+=h;ticks+=t;entries.append({'pid':int(pid),'comm':comm,'rss_kib':r,'hwm_kib':h})
        except FileNotFoundError: pass
    return {'rss_kib':rss,'pss_kib':pss if pss_available else None,'private_kib':private if pss_available else None,'sum_process_hwm_kib':hwm,'ticks':ticks,'processes':entries}

def monitor():
    baseline=health(8080); bad=0; prev={}; last=time.monotonic(); swap_start=None
    if not baseline[0]: halt('Existing installation unhealthy before load'); return
    while not STOP.is_set():
        try:
            now=time.monotonic(); mem={k:int(v.split()[0]) for k,v in (l.split(':',1) for l in Path('/proc/meminfo').read_text().splitlines())}
            row={'time':time.time(),'available_kib':mem['MemAvailable'],'swap_used_kib':mem['SwapTotal']-mem['SwapFree'],'load':os.getloadavg(),'generator_maxrss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
            if swap_start is None:swap_start=row['swap_used_kib']
            if row['swap_used_kib']-swap_start>128*1024:halt('Swap growth above 128 MiB')
            row['generator_cpu_seconds']=sum(os.times()[:2])
            row['disk_free']=os.statvfs('/opt').f_bavail*os.statvfs('/opt').f_frsize
            for name in ['inkgroove-dev-app','inkgroove-dev-db']:
                p=processes(name);p['cpu_percent']=round(100*(p['ticks']-prev.get(name,p['ticks']))/os.sysconf('SC_CLK_TCK')/max(.001,now-last),2);prev[name]=p['ticks'];row[name]=p
            row['dev_health']=health(8083);row['existing_health']=health(8080)
            bad=bad+1 if not row['existing_health'][0] or row['existing_health'][1]>max(1000,baseline[1]*5) or not row['dev_health'][0] else 0
            SAMPLES.append(row);last=now
            if mem['MemAvailable']<600*1024: halt('MemAvailable below 600 MiB')
            if row['disk_free']<5*1024**3: halt('Disk below 5 GiB')
            if bad>=2: halt('Two degraded health samples; dev='+str(row['dev_health'])+' existing='+str(row['existing_health']))
        except Exception as e: halt('Monitor failed: '+type(e).__name__)
        STOP.wait(2)

class Client:
    def __init__(self,record):
        self.record=record;self.token=None;self.seq=0;self.sid=str(uuid.uuid4());self.revision=0;self.html='<p>Inicio ficticio pingüino génesis</p>'
        self.cookiefile=OUT/('cookies-'+str(record['id'])+'.txt')
        self.jar=http.cookiejar.LWPCookieJar(str(self.cookiefile))
        if self.cookiefile.exists():self.jar.load(ignore_discard=True)
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
    def request(self,path,data=None,method=None,kind='setup',due=None,phase='setup',expected=(200,201)):
        start=time.monotonic(); code=0; payload={}
        try:
            h={'Accept':'application/json','Content-Type':'application/json','Accept-Encoding':'gzip','X-Capacity-Probe':'1'}
            if self.token:h['X-CSRF-TOKEN']=self.token
            req=urllib.request.Request(BASE+path,data=json.dumps(data,ensure_ascii=False).encode() if data is not None else None,headers=h,method=method)
            try: response=self.opener.open(req,timeout=5)
            except urllib.error.HTTPError as e: response=e
            with response:
                code=response.code;body=response.read();wire=len(body)
                if response.headers.get('Content-Encoding')=='gzip': body=gzip.decompress(body)
                payload=json.loads(body)
        except Exception: wire=0
        row={'phase':phase,'kind':kind,'status':code,'ms':(time.monotonic()-start)*1000,'queue_ms':max(0,(start-(due or start))*1000),'bytes':wire,'expected':code in expected}
        with LOCK:
            ROWS.append(row)
            recent=[r for r in ROWS[-100:] if r['phase']==phase]
            if len(recent)>=20 and sum(r['status']==0 or r['status']>=500 for r in recent)>=5: halt('Sustained transport/5xx errors')
        return code,payload
    def login(self,phase='setup'):
        if phase!='login-burst' and self.cookiefile.exists():
            code,p=self.request('/api/me',kind='resume-auth',phase=phase)
            if code==200 and p['user']['id']==self.record['id']:
                code,p=self.request('/api/csrf-token',kind='csrf-refresh',phase=phase)
                if code==200:self.token=p['csrf_token'];return code,p
        if not self.token:
            c,p=self.request('/api/csrf-token',kind='csrf',phase=phase)
            if c!=200:return c,p
            self.token=p.get('csrf_token')
        code,p=self.request('/api/auth/login',{'email':self.record['email'],'password':'Fictitious12345'},kind='login',phase=phase)
        if code==200:
            # Laravel rotates CSRF on session regeneration. Refresh after login.
            fresh,token=self.request('/api/csrf-token',kind='csrf-refresh',phase=phase)
            if fresh!=200:return fresh,token
            self.token=token['csrf_token']
            self.jar.save(ignore_discard=True);os.chmod(self.cookiefile,0o600)
        return code,p
    def open(self,phase):
        c,p=self.request('/api/documents/'+self.record['document'],kind='open',phase=phase)
        if c==200:self.revision=p['document']['revision'];self.html=p['document']['content_html']
        return c
    def history(self,phase,version=None,kind='history'):
        params={'metadata':1}
        if version:params['version_id']=version
        n=0
        while not STOP.is_set():
            c,p=self.request('/api/documents/'+self.record['document']+'/timeline?'+urllib.parse.urlencode(params),kind=kind,phase=phase)
            if c!=200: break
            n+=len(p['events']);cursor=p.get('next_cursor')
            if not cursor:break
            params.update(cursor=cursor,before_id=p['before_id'])
        return n
    def write(self,phase,due,batch=6):
        events=[]
        for j in range(batch):
            self.seq+=1
            # Growing direct text with Unicode; periodically revise instead of append.
            if self.seq%20==0:self.html=self.html.replace('ficticio','revisado',1)
            else:self.html=self.html[:-4]+' á'+str(self.seq)+'</p>'
            events.append({'sequence':self.seq,'event_type':'insert' if self.seq%20 else 'delete','input_type':'insertText','data':'á','after_html':self.html,'elapsed_ms':self.seq*200})
        c,p=self.request('/api/documents/'+self.record['document']+'/events',{'session_id':self.sid,'events':events},kind='events',due=due,phase=phase)
        if c!=200 or p.get('accepted')!=batch: halt('Event batch not accepted');return False
        return True
    def save(self,phase,due=None):
        c,p=self.request('/api/documents/'+self.record['document'],{'revision':self.revision,'content_html':self.html},method='PATCH',kind='save',due=due,phase=phase)
        if c==200:self.revision=p['document']['revision']
        else:halt('Save failed')


def run_level(clients,teacher,n,duration=60,long_version=None):
    if n not in [1,5,15,30,60,90,150] or n>len(clients):raise ValueError('Requested writers exceed the registered fixture cohort')
    phase=('long-writers-' if long_version else 'writers-')+str(n);start=time.monotonic(); offered=collections.Counter()
    def writer(i,c):
        c.open(phase);c.open(phase);c.history(phase)
        # A 6 s cycle: 3.6 s typing at 5 chars/s (3 batches), pause + save.
        for cycle in range(duration//6):
            for offset in [0,1.2,2.4,4.7]:
                due=start+cycle*6+offset+(i%10)*.06
                if STOP.wait(max(0,due-time.monotonic())):return
                with LOCK:offered['save' if offset==4.7 else 'events']+=1
                if offset==4.7:c.save(phase,due)
                elif not c.write(phase,due):return
        c.save(phase)
    def reader():
        for k in range(duration//6):
            due=start+k*6
            if STOP.wait(max(0,due-time.monotonic())):return
            teacher.request('/api/submissions',kind='teacher-list',phase=phase,due=due)
            teacher.request('/api/submissions/'+str(teacher.submission),kind='teacher-version',phase=phase)
            if k==0 and long_version:teacher.history(phase,long_version,kind='long-history')
    with futures.ThreadPoolExecutor(max_workers=n+1) as pool:
        jobs=[pool.submit(writer,i,c) for i,c in enumerate(clients[:n])]+[pool.submit(reader)]
        for job in jobs:job.result()
    elapsed=time.monotonic()-start
    subset=[r for r in ROWS if r['phase']==phase]
    result={'writers':n,'scheduled_seconds':duration,'planned_regular_write_requests':n*(duration//6)*4,'elapsed_seconds':elapsed,'offered_writes':dict(offered),'completed_requests':len(subset),'rps':len(subset)/elapsed,'stop':list(REASON)}
    result['groups']={kind:{'count':len(rs),'p50_ms':percentile([r['ms'] for r in rs],.5),'p95_ms':percentile([r['ms'] for r in rs],.95),'queue_p95_ms':percentile([r['queue_ms'] for r in rs],.95),'status':dict(collections.Counter(r['status'] for r in rs))} for kind in sorted(set(r['kind'] for r in subset)) for rs in [[r for r in subset if r['kind']==kind]]}
    print(json.dumps(result),flush=True);return result


def main():
    if Path.cwd()!=Path('/opt/veritas-dev'):raise SystemExit('Run from dev root')
    OUT.mkdir(mode=0o700,exist_ok=True)
    m=json.loads(Path('storage/app/capacity-fixture.json').read_text());clients=[Client(r) for r in m['users'][:-1]];teacher=Client(m['users'][-1])
    monitor_thread=threading.Thread(target=monitor);monitor_thread.start();time.sleep(3)
    results=[]
    try:
        if STOP.is_set():return
        # Explicit class login burst, same IP, separate cookies. Do not evade throttle.
        if '--authenticated' not in sys.argv:
            with futures.ThreadPoolExecutor(max_workers=5) as p:list(p.map(lambda c:c.login('login-burst'),clients))
        print(json.dumps({'login_burst':dict(collections.Counter(r['status'] for r in ROWS if r['kind']=='login' and r['phase']=='login-burst')),'csrf_burst':dict(collections.Counter(r['status'] for r in ROWS if r['kind']=='csrf' and r['phase']=='login-burst'))}),flush=True)
        # Authenticated load is prepared under the unmodified login limiter.
        for c in clients+[teacher]:
            while not STOP.is_set():
                code,p=c.login()
                if code==200:break
                if code!=429:halt('Authentication setup failed');break
                STOP.wait(15)
        if STOP.is_set():return
        if '--long' in sys.argv:
            stored=json.loads((OUT/'storage.json').read_text())
            long=next(row for row in stored['storage'] if row['label']=='25000')
            teacher.submission=long['submission_id'];teacher.record['document']=long['active_document']
            n=int(sys.argv[sys.argv.index('--long')+1])
            result=run_level(clients,teacher,n,long_version=long['version_id']);results.append(result)
            if any(any(int(status)!=200 for status in g['status']) or (g['p95_ms'] or 0)>1000 or (g['queue_p95_ms'] or 0)>500 for g in result['groups'].values()):halt('Long-history latency/queue/status stability gate')
            return
        for c in clients:c.open('warmup')
        a=clients[0];a.write('warmup',time.monotonic());a.save('warmup')
        if STOP.is_set():return
        code,p=a.request('/api/documents/'+a.record['document']+'/seal',{},kind='seal')
        version=p['version']['id'];sealed_count=a.history('sealed-baseline')
        code,p=a.request('/api/submissions',{'document_version_id':version,'recipient_email':teacher.record['email']},kind='submit');teacher.submission=p['submission']['id']
        # warm cache with real teacher reading; warmup excluded from level quantiles.
        teacher.request('/api/submissions/'+str(teacher.submission))
        for n in ([int(sys.argv[sys.argv.index('--normal-level')+1])] if '--normal-level' in sys.argv else [1,5,15,30]):
            if STOP.is_set():break
            r=run_level(clients,teacher,n);results.append(r)
            if any(any(int(status)!=200 for status in g['status']) or (g['p95_ms'] or 0)>1000 or (g['queue_p95_ms'] or 0)>500 for g in r['groups'].values()):halt('Level failed latency/queue/status stability gate')
            STOP.wait(5)
        # Assertions independent of database HMAC audit.
        if not STOP.is_set():
            for c in clients:
                expected=c.html;rev=c.revision
                code,p=c.request('/api/documents/'+c.record['document'],kind='verify')
                if code!=200 or p['document']['content_html']!=expected or p['document']['revision']!=rev:raise AssertionError('Content/revision mismatch')
            teacher.record['document']=a.record['document']
            code,p=teacher.request('/api/documents/'+a.record['document'],kind='privacy-live',expected=(404,))
            assert code==404
            count=teacher.history('privacy-boundary',version)
            assert count==sealed_count,(count,'boundary leak')
            print(json.dumps({'content_revision_valid':True,'sealed_teacher_events':count,'live_denied':True}),flush=True)
    finally:
        (OUT/'expected.json').write_text(json.dumps([{'document':c.record['document'],'session':c.sid,'sequence':c.seq,'revision':c.revision,'html':c.html} for c in clients]));os.chmod(OUT/'expected.json',0o600)
        STOP.set();monitor_thread.join(timeout=15)
        (OUT/'http.json').write_text(json.dumps({'levels':results,'requests':ROWS,'samples':SAMPLES,'stop':REASON},indent=2));os.chmod(OUT/'http.json',0o600)
        print(json.dumps({'samples':len(SAMPLES),'stop':REASON,'generator_peak_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}),flush=True)

if __name__=='__main__':main()
