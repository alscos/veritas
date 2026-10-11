"""Dev-only sequential trial; persistent 600s ledger and existing resource guards.

No automatic retry. After any stop only cleanup and final health run.
Use the documented node image/Compose runner, never production or migrations.
"""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid
from chromium_real_errors import finalize, cleanup_actions, browser_report

class PhaseError(RuntimeError):
    def __init__(self, phase, exit_code):
        super().__init__('Phase failed: '+phase)
        self.phase=phase;self.exit_code=exit_code

ROOT=Path('/opt/veritas-dev')
PRIVATE=ROOT/'.dev-private/chromium-real'
MANIFEST=ROOT/'storage/app/chromium-real.json'
PUBLIC=ROOT/'docs/measurements/chromium-real-20261011.json'
CONFIG='/etc/apache2/conf-enabled/inkgroove-chromium-real.conf'
DIRECTIVE='php_value auto_prepend_file /workspace/scripts/chromium-real-probe.php\n'
DC=['docker','compose','--project-directory',str(ROOT),'--env-file','/dev/null','-p','inkgroove-dev','-f',str(ROOT/'compose.dev.yaml')]

def utc(): return dt.datetime.now(dt.timezone.utc).isoformat()
def write(path,value):
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(value,indent=2));os.chmod(temp,0o600);temp.replace(path)

def main():
    if Path.cwd()!=ROOT or ROOT.resolve()!=ROOT: raise SystemExit('Dev root only')
    if PRIVATE.exists() or MANIFEST.exists(): raise SystemExit('Inventory already exists; do not repeat/reset budget')
    prior=None
    if PUBLIC.exists():
        if sys.argv[1:]!=['--retry']:raise SystemExit('Persistent result exists; do not reset budget')
        prior=json.loads(PUBLIC.read_text())
        if prior['attempts']!=1 or prior.get('guard_stop') or prior.get('trial_passed') or not prior.get('cleanup_verified') or prior['consumed_seconds']>=600:raise SystemExit('Retry forbidden by prior state')
        if prior.get('browser',{}).get('failed_stage')!='save' or not any(r['method']=='PATCH' and r['status']==419 for r in prior['browser']['http_responses']):raise SystemExit('This correction does not match the demonstrated failure')
    elif sys.argv[1:]:raise SystemExit('Retry requires the persistent first attempt')
    run=str(uuid.uuid4());name='inkgroove-chromium-real-'+run[:8]
    registry='/tmp/inkgroove-chromium-real-'+run+'.jsonl'
    if subprocess.check_output(['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],text=True).strip(): raise SystemExit('Runner exists')
    PRIVATE.mkdir(mode=0o700)
    manifest={'run':run,'attempt':2 if prior else 1,'email':'chromium-real-'+run+'@example.test','document_id':str(uuid.uuid4()),'seed_sessions':[str(uuid.uuid4()),str(uuid.uuid4())],'session_registry':registry,'runner_name':name,'temporary_config':CONFIG,'private_directory':str(PRIVATE),'seed_events':1800,'event_ceiling':2000}
    write(MANIFEST,manifest)
    ledger={'run':run,'budget_seconds':600,'consumed_seconds':prior['consumed_seconds'] if prior else 0,'attempts':prior['attempts'] if prior else 0,'started_at':utc(),'phases':[],'inventory':{'document_id':manifest['document_id'],'seed_sessions':manifest['seed_sessions'],'runner_name':name,'temporary_config':CONFIG,'session_registry_path':registry},'guard_stop':[]}
    if prior:ledger['previous_attempts']=[prior]
    write(PRIVATE/'ledger.json',ledger)
    spec=importlib.util.spec_from_file_location('capacity',ROOT/'scripts/measure-capacity.py');guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)
    monitor=None;probe_owned=False

    def phase(label,command,cleanup=False,limit=60):
        if not cleanup and guard.STOP.is_set(): raise RuntimeError('Guard stopped trial')
        remaining=600-ledger['consumed_seconds']
        if not cleanup and remaining<=0: raise RuntimeError('Trial budget exhausted')
        row={'phase':label,'start_utc':utc(),'cleanup_or_final_health':cleanup}
        ledger['active_phase']=row.copy();write(PRIVATE/'ledger.json',ledger)
        start=time.monotonic();p=None;output='';status=-1
        try:
            p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
            deadline=start+min(limit,remaining) if not cleanup else start+limit
            while p.poll() is None:
                if time.monotonic()>deadline or (not cleanup and guard.STOP.is_set()):
                    # Only stop the manifest's runner, checked against project label.
                    if label=='browser':
                        check=subprocess.run(['docker','inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',name],capture_output=True,text=True)
                        if check.returncode==0 and check.stdout.strip()=='inkgroove-dev':subprocess.run(['docker','stop','-t','3',name],capture_output=True,timeout=15)
                    p.terminate()
                    try:p.wait(timeout=10)
                    except subprocess.TimeoutExpired:p.kill()
                    if not guard.STOP.is_set():guard.halt('Phase deadline or accumulated trial budget')
                    break
                time.sleep(.2)
            output=p.communicate(timeout=10)[0];status=p.returncode
            (PRIVATE/(label+'.log')).write_text(output);os.chmod(PRIVATE/(label+'.log'),0o600)
            if label=='browser':
                report=browser_report(output,manifest['attempt'])
                if report is not None:ledger['browser']=report
            if status!=0:raise PhaseError(label,status)
            return output
        finally:
            elapsed=time.monotonic()-start
            row.update(end_utc=utc(),elapsed_seconds=round(elapsed,3),exit_code=status)
            ledger['phases'].append(row)
            ledger['consumed_seconds']=round(ledger['consumed_seconds']+elapsed,3)
            ledger.pop('active_phase',None);write(PRIVATE/'ledger.json',ledger)

    def php(action):
        cap=45
        if action=='integrity':
            # Bound PHP itself, not just the docker-exec client; leave 1s to kill it.
            cap=min(45,int(ledger['budget_seconds']-ledger['consumed_seconds'])-1)
            if cap<1:raise RuntimeError('Insufficient audit budget')
        return ['docker','exec','inkgroove-dev-app','timeout','--kill-after=1',str(cap),'php','scripts/chromium-real-fixture.php',action]

    try:
        # No payloads/private configuration in preflight output.
        preflight=phase('preflight',['docker','exec','inkgroove-dev-app','python3','-c',
            "import pathlib,json,subprocess; p=pathlib.Path('/etc/apache2/mods-enabled/mpm_prefork.conf'); s=p.read_text(); assert 'ServerLimit 2' in s and 'MaxRequestWorkers 2' in s; assert not pathlib.Path('"+CONFIG+"').exists(); assert not pathlib.Path('"+registry+"').exists(); n=subprocess.check_output(['ps','-eo','comm'],text=True).splitlines().count('apache2'); assert n==3; syntax=subprocess.run(['apachectl','-t'],capture_output=True,text=True); assert syntax.returncode==0; mods=subprocess.check_output(['apachectl','-M'],stderr=subprocess.DEVNULL,text=True); assert 'mpm_prefork_module' in mods; print(json.dumps({'apache_processes':n,'pool_config':s,'syntax_ok':True,'prefork':True}));"])
        ledger['preflight']=json.loads(preflight)
        state=phase('container_status',['sh','scripts/dev-server.sh','status'])
        if state.count('(healthy)')!=2:raise RuntimeError('Dev containers unhealthy')
        phase('php_syntax',['docker','exec','inkgroove-dev-app','php','-l','scripts/chromium-real-fixture.php'])
        phase('probe_syntax',['docker','exec','inkgroove-dev-app','php','-l','scripts/chromium-real-probe.php'])
        phase('node_syntax',DC+['run','--rm','--no-deps','node','node','--check','scripts/chromium-real-browser.mjs'])
        phase('inventory_access',['docker','exec','inkgroove-dev-app','chown','www-data:www-data','/workspace/storage/app/chromium-real.json'])
        # Reuse all existing guard thresholds, including the read-only existing health check.
        start=time.monotonic();started=utc();monitor=threading.Thread(target=guard.monitor);monitor.start()
        guard.STOP.wait(3)
        elapsed=time.monotonic()-start
        ledger['phases'].append({'phase':'initial_guards','start_utc':started,'end_utc':utc(),'elapsed_seconds':round(elapsed,3),'exit_code':0 if not guard.STOP.is_set() else 1,'cleanup_or_final_health':False})
        ledger['consumed_seconds']=round(ledger['consumed_seconds']+elapsed,3);write(PRIVATE/'ledger.json',ledger)
        if guard.STOP.is_set():raise RuntimeError('Initial resource guard')
        probe_owned=True # Preflight established absence; this phase owns any partial file.
        phase('probe_install',['docker','exec','inkgroove-dev-app','sh','-ec',
            "test ! -e "+CONFIG+"; printf '%s\\n' 'php_value auto_prepend_file /workspace/scripts/chromium-real-probe.php' > "+CONFIG+"; apachectl -t; apachectl graceful"])
        # Let graceful old workers exit; no pool change.
        phase('probe_ready',['docker','exec','inkgroove-dev-app','sh','-ec','sleep 2; apachectl -t'])
        ledger['seed']=json.loads(phase('fixture',php('seed')))
        ledger['attempts']=manifest['attempt'];write(PRIVATE/'ledger.json',ledger)
        phase('browser',DC+['run','--rm','--no-deps','--name',name,'node','node','scripts/chromium-real-browser.mjs'],limit=240)
        if guard.STOP.is_set():raise RuntimeError('Guard stopped browser')
        ledger['trial_passed']=True
    except Exception as e:
        ledger['trial_passed']=False;ledger['failure']=str(e) if isinstance(e,RuntimeError) else type(e).__name__
    finally:
        # Preserve the browser's original exception before auditing or cleaning.
        browser_closed=False
        if (PRIVATE/'browser.json').exists():
            try:
                ledger['browser']=json.loads((PRIVATE/'browser.json').read_text())
                browser_closed=ledger['browser'].get('browser_closed') is True
                if ledger['browser'].get('failure'):ledger['original_browser_failure']=ledger['browser']['failure']
                if ledger['browser'].get('passed') is not True:ledger['trial_passed']=False
            except Exception as error:
                ledger['browser_report_error']={'type':type(error).__name__}
                ledger['trial_passed']=False
        if ledger.get('browser'):
            browser_closed=ledger['browser'].get('browser_closed') is True
            if ledger['browser'].get('failure'):ledger['original_browser_failure']=ledger['browser']['failure']

        def scoped_cleanup():
            # Only stop the monitor after the audit decision/action; don't mask a live guard.
            ledger['guard_stop']=list(guard.REASON)
            guard.STOP.set()
            if monitor:monitor.join(timeout=15)
            def clean_fixture():ledger['cleanup']=json.loads(phase('fixture_clean',php('clean'),cleanup=True))
            def remove_probe():
                if probe_owned:
                    # If row cleanup failed, retain exact session hashes for recovery.
                    remove_registry='; rm -f '+registry if ledger.get('cleanup',{}).get('remaining_inventoried_rows')==0 else ''
                    phase('probe_remove',['docker','exec','inkgroove-dev-app','sh','-ec',
                        "if test -e "+CONFIG+"; then test \"$(cat "+CONFIG+")\" = 'php_value auto_prepend_file /workspace/scripts/chromium-real-probe.php'; rm "+CONFIG+"; apachectl -t; apachectl graceful; fi"+remove_registry],cleanup=True)
            def final_health():
                final_status=phase('final_status',['sh','scripts/dev-server.sh','status'],cleanup=True)
                health_start=time.monotonic();health_utc=utc();health=guard.health(8083)
                health_duration=time.monotonic()-health_start
                ledger['phases'].append({'phase':'final_health','start_utc':health_utc,'end_utc':utc(),'elapsed_seconds':round(health_duration,3),'exit_code':0 if health[0] else 1,'cleanup_or_final_health':True})
                ledger['consumed_seconds']=round(ledger['consumed_seconds']+health_duration,3)
                ledger['final_dev_health']={'ok':health[0],'milliseconds':health[1]}
                if not health[0] or final_status.count('(healthy)')!=2:raise RuntimeError('Development unhealthy at closure')
            def check_absence():
                phase('absence',['docker','exec','inkgroove-dev-app','sh','-ec',
                    'test ! -e '+CONFIG+'; test ! -e '+registry+'; test ! -e /workspace/storage/app/chromium-real.json; echo inventoried_temporary_files_absent'],cleanup=True)
                left=subprocess.check_output(['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],text=True).strip()
                ledger['runner_absent']=not left
                if left:raise RuntimeError('Owned runner remains')
            cleanup_actions(ledger,[('fixture',clean_fixture),('probe',remove_probe),('health',final_health),('absence',check_absence)])
            ledger['cleanup_verified']=True

        finalize(ledger,guard,'seed' in ledger,browser_closed,
                 lambda:json.loads(phase('integrity',php('integrity'))),scoped_cleanup)
        samples=guard.SAMPLES
        ledger['resources']={'samples':len(samples),'available_min_mib':min((s['available_kib']/1024 for s in samples),default=None),'disk_free_min_gib':min((s['disk_free']/1024**3 for s in samples),default=None),'swap_growth_mib':(max((s['swap_used_kib'] for s in samples),default=0)-min((s['swap_used_kib'] for s in samples),default=0))/1024,'dev_health_failures':sum(not s['dev_health'][0] for s in samples),'existing_health_failures':sum(not s['existing_health'][0] for s in samples)}
        ledger['resources']['initial_available_mib']=samples[0]['available_kib']/1024 if samples else None
        ledger['resources']['allowed_cpus']=list(os.sched_getaffinity(0))
        ledger['finished_at']=utc();write(PRIVATE/'ledger.json',ledger)
        # Public aggregate contains no session hashes, content, passwords or headers.
        write(PUBLIC,ledger)
        print(json.dumps(ledger,indent=2),flush=True)
        # Retire only the exact owned private files; preserve unknown residue for inspection.
        allowed={'ledger.json','browser.json'}|{r['phase']+'.log' for r in ledger['phases']}
        residue=[p.name for p in PRIVATE.iterdir() if p.name not in allowed]
        # An audit error must keep its private subprocess log even when row cleanup passed.
        report_missing=any(row['phase']=='browser' for row in ledger['phases']) and not ledger.get('browser')
        if not residue and ledger.get('cleanup_verified') and ledger.get('integrity_status',{}).get('state')!='failed' and not ledger.get('browser_report_error') and not report_missing:
            for p in PRIVATE.iterdir():p.unlink()
            PRIVATE.rmdir()
        if residue:print(json.dumps({'unattributed_private_residue_count':len(residue)}))
    return 0 if ledger.get('trial_passed') and ledger.get('cleanup_verified') else 1

if __name__=='__main__':raise SystemExit(main())
