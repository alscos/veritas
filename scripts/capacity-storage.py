"""Real HTTP growth samples. Only manifest-owned accounts/documents.
The compressed fixture SQL export is a data-size sample, not a restorable backup.
"""
import importlib.util, json, time, threading, os, struct, zlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('load','scripts/measure-capacity.py');load=importlib.util.module_from_spec(spec);spec.loader.exec_module(load)

def snapshot(label):
    p=json.loads(load.docker('exec','inkgroove-dev-app','php','scripts/capacity-fixture.php','storage'))
    p['label']=label
    p['physical']=[load.docker('exec','inkgroove-dev-db','du','-sk',path).strip() for path in ['/var/lib/mysql/inkgroove_dev','/var/lib/mysql']]
    return p

def request(c,path,data=None,**kw):
    while not load.STOP.is_set():
        code,p=c.request(path,data,**kw)
        if code==429:load.STOP.wait(15);continue
        if code not in (200,201):raise RuntimeError('HTTP '+str(code))
        return p
    raise RuntimeError('Guard stopped storage run')

def main():
    if Path.cwd()!=Path('/opt/veritas-dev'):raise SystemExit('Dev root only')
    m=json.loads(Path('storage/app/capacity-fixture.json').read_text());c=load.Client(m['users'][29])
    t=threading.Thread(target=load.monitor);t.start();samples=[]
    try:
        while not load.STOP.is_set():
            code,p=c.login('storage-login')
            if code==200:break
            if code!=429:raise RuntimeError('Login failed')
            load.STOP.wait(15)
        samples.append(snapshot('before'))
        for count in [100,1000,5000,25000]:
            if load.STOP.is_set():break
            p=request(c,'/api/documents',{'title':'Capacity growing '+str(count)},kind='create',phase='storage')
            c.record['document']=p['document']['id'];c.sid=str(load.uuid.uuid4());c.seq=0;c.revision=0
            started=time.monotonic()
            for first in range(1,count+1,250):
                events=[]
                for seq in range(first,min(count+1,first+250)):
                    # 1k initial -> 12k final chars, NFC/NFD and empty paragraphs.
                    words=max(30,int(30+seq/count*470))
                    c.html='<p>'+('pingüino génesis texto ' * words)+str(seq)+'</p><p></p>'
                    events.append({'sequence':seq,'event_type':'insert','input_type':'insertText','data':'x','after_html':c.html,'elapsed_ms':seq*200})
                p=request(c,'/api/documents/'+c.record['document']+'/events',{'session_id':c.sid,'events':events},kind='storage-events',phase='storage')
                assert p['accepted']==len(events)
                load.STOP.wait(1.3)
            p=request(c,'/api/documents/'+c.record['document'],{'revision':0,'content_html':c.html},method='PATCH',kind='save',phase='storage')
            assert p['document']['revision']==1
            row=snapshot(str(count));row['active_document']=c.record['document'];row['ingestion_seconds']=time.monotonic()-started;samples.append(row)
            if count==25000:
                sealed=request(c,'/api/documents/'+c.record['document']+'/seal',{},kind='seal',phase='storage')
                row['version_id']=sealed['version']['id']
                submitted=request(c,'/api/submissions',{'document_version_id':row['version_id'],'recipient_email':m['users'][-1]['email']},kind='submit',phase='storage')
                row['submission_id']=submitted['submission']['id']
            print(json.dumps({'storage_events':count,'seconds':row['ingestion_seconds'],'physical':row['physical']}),flush=True)
            # Three first HTTP details, three reopens, all history pages + metrics cost.
            for run in range(3):c.open('storage-open-'+str(count));c.open('storage-reopen-'+str(count))
            n=c.history('storage-history-'+str(count));assert n==count
        # Incompressible fictitious PNG, real upload, no external image or private file.
        def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
        width=height=512
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(b'\0'+os.urandom(width*3) for _ in range(height))))+chunk(b'IEND',b'')
        boundary='Capacity'+str(load.uuid.uuid4())
        body=('--'+boundary+'\r\nContent-Disposition: form-data; name="image"; filename="fictitious.png"\r\nContent-Type: image/png\r\n\r\n').encode()+png+('\r\n--'+boundary+'--\r\n').encode()
        req=load.urllib.request.Request(load.BASE+'/api/documents/'+c.record['document']+'/images',data=body,headers={'Accept':'application/json','Content-Type':'multipart/form-data; boundary='+boundary,'X-CSRF-TOKEN':c.token,'X-Capacity-Probe':'1'})
        with c.opener.open(req,timeout=5) as response:
            assert response.status==201
            image=json.load(response)['image'];assert image['bytes']==len(png)
        image_row=snapshot('image-upload');image_row['image_id']=image['id'];samples.append(image_row)
        print(json.dumps({'image_bytes':len(png),'gzip_image_bytes':len(load.gzip.compress(png,compresslevel=1))}),flush=True)
        p=load.docker('exec','inkgroove-dev-app','php','scripts/capacity-fixture.php','export')
        print(p,flush=True)
    finally:
        load.STOP.set();t.join(timeout=15)
        (load.OUT/'storage.json').write_text(json.dumps({'storage':samples,'requests':load.ROWS,'samples':load.SAMPLES,'stop':load.REASON},indent=2));os.chmod(load.OUT/'storage.json',0o600)
if __name__=='__main__':main()
