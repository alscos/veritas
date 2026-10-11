"""Mac HTTP through the SSH tunnel; only a dedicated fictitious account."""
import urllib.request, http.cookiejar, json, time, gzip, sys
base, email, doc = sys.argv[1:4]
query = sys.argv[4] if len(sys.argv) > 4 else ""
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def request(path, data=None, headers=None):
    return client.open(urllib.request.Request(base+path, data=json.dumps(data).encode() if data else None, headers={'Accept':'application/json','Content-Type':'application/json', **(headers or {})}))
token = json.load(request('/api/csrf-token'))['csrf_token']
request('/api/auth/login', {'email':email,'password':'Fictitious12345'}, {'X-CSRF-TOKEN':token}).close()
for encoding in ['identity','gzip']:
    for run in range(3):
        start=time.perf_counter(); path='/api/documents/'+doc+'/timeline'+query
        wire=0; decoded_total=0; count=0; pages=0; content_encoding=None; encodings=[]
        while True:
            with request(path,headers={'Accept-Encoding':encoding}) as response:
                body=response.read();content_encoding=response.headers.get('Content-Encoding')
                encodings.append(content_encoding or 'identity')
                decoded=gzip.decompress(body) if content_encoding=='gzip' else body
                payload=json.loads(decoded);wire+=len(body);decoded_total+=len(decoded);count+=len(payload['events']);pages+=1
                cursor=payload.get('next_cursor')
                if len(sys.argv)<6 or sys.argv[5]!='--all' or not cursor: break
                from urllib.parse import urlencode
                path='/api/documents/'+doc+'/timeline?'+urlencode({'metadata':1,'cursor':cursor,'before_id':payload['before_id']})
        print(json.dumps({'encoding':encoding,'run':run,'ms':round((time.perf_counter()-start)*1000,2),'bytes':wire,'decoded_bytes':decoded_total,'events':count,'pages':pages,'page_encodings':encodings,'vary':response.headers.get('Vary')}))
