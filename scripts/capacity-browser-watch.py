"""One owned ephemeral browser runner with host guard monitor and procfs RSS."""
import importlib.util,json,subprocess,time,threading,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('load','scripts/measure-capacity.py');load=importlib.util.module_from_spec(spec);spec.loader.exec_module(load)
if Path.cwd()!=Path('/opt/veritas-dev'):raise SystemExit('Dev only')
name='inkgroove-capacity-browser'
if load.docker('ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}').strip():raise SystemExit('Runner name exists')
t=threading.Thread(target=load.monitor);t.start();time.sleep(3)
rows=[];previous_ticks=None;previous_time=None
try:
    if load.STOP.is_set():raise RuntimeError('Guard')
    p=subprocess.Popen(['docker','compose','--env-file','/dev/null','-p','inkgroove-dev','-f','compose.dev.yaml','run','--rm','--no-deps','--name',name,'node','node','scripts/capacity-browser.mjs'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    start=time.monotonic()
    while p.poll() is None:
        if load.STOP.is_set() or time.monotonic()-start>240:
            # Scope the stop by project label, name is reserved above.
            project=load.docker('inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',name).strip()
            if project!='inkgroove-dev':raise RuntimeError('Runner identity changed')
            load.docker('stop','-t','3',name);break
        try:
            row=load.processes(name);now=time.monotonic();row['sample_monotonic']=now
            row['cpu_percent']=max(0,100*(row['ticks']-previous_ticks)/os.sysconf('SC_CLK_TCK')/(now-previous_time)) if previous_ticks is not None else None
            previous_ticks=row['ticks'];previous_time=now;rows.append(row)
        except subprocess.CalledProcessError:pass
        time.sleep(1)
    output=p.communicate(timeout=15)[0];print(output,flush=True)
    print(json.dumps({'browser_runner_peak_sampled_rss_kib':max((r['rss_kib'] for r in rows),default=0),'exit_code':p.returncode,'stop':load.REASON}),flush=True)
finally:
    load.STOP.set();t.join(timeout=15)
    target=load.OUT/'browser.json';target.write_text(json.dumps({'runner':rows,'host':load.SAMPLES,'stop':load.REASON},indent=2));os.chmod(target,0o600)
