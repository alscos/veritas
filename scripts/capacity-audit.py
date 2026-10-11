"""Read-only HTTP boundaries/content audit, plus fixture-only DB HMAC verifier."""
import importlib.util,json,threading,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('load','scripts/measure-capacity.py');load=importlib.util.module_from_spec(spec);spec.loader.exec_module(load)
if Path.cwd()!=Path('/opt/veritas-dev'):raise SystemExit('Dev only')
m=json.loads(Path('storage/app/capacity-fixture.json').read_text())
teacher=load.Client(m['users'][-1]);teacher.login('audit')
t=threading.Thread(target=load.monitor);t.start();checks=[]
try:
    code,p=teacher.request('/api/submissions');assert code==200
    for entry in p['received']:
        code,p=teacher.request('/api/submissions/'+str(entry['id']));assert code==200
        version=p['version'];doc=version['document_id'];teacher.record['document']=doc
        boundary=version['certificate']['signed_payload']['history_boundary'];expected=sum(h['sequence'] for h in boundary.values())
        count=teacher.history('audit-sealed',version['id']);assert count==expected
        code,_=teacher.request('/api/documents/'+doc,kind='live-denied',expected=(404,));assert code==404
        owner_record=m['users'][0] if doc==m['users'][0]['document'] else m['users'][29]
        owner=load.Client({**owner_record,'document':doc});assert owner.login('audit')[0]==200
        code,p=owner.request('/api/documents/'+doc+'/timeline?metadata=1&limit=1');assert code==200
        live=p['total'];snapshot_denied=False
        if live>expected:
            code,_=teacher.request('/api/documents/'+doc+'/timeline?version_id='+version['id']+'&event_id='+str(p['before_id']),kind='snapshot-denied',expected=(404,));assert code==404;snapshot_denied=True
        checks.append({'sealed_events':count,'live_events':live,'live_denied':True,'later_snapshot_denied':snapshot_denied})
    storage=json.loads((load.OUT/'storage.json').read_text());image=next(r for r in storage['storage'] if r['label']=='image-upload');long=next(r for r in storage['storage'] if r['label']=='25000')
    code,_=teacher.request('/api/documents/'+long['active_document']+'/images/'+image['image_id']+'?version_id='+long['version_id'],kind='late-image-denied',expected=(404,));assert code==404
    integrity=json.loads(load.docker('exec','inkgroove-dev-app','php','scripts/capacity-fixture.php','integrity'))
    print(json.dumps({'http_boundaries':checks,'late_image_denied':True,'integrity':integrity,'stop':load.REASON}),flush=True)
finally:
    load.STOP.set();t.join(timeout=15)
    target=load.OUT/'audit.json';target.write_text(json.dumps({'checks':checks,'requests':load.ROWS,'samples':load.SAMPLES,'stop':load.REASON},indent=2));os.chmod(target,0o600)
