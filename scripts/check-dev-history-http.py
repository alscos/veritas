"""Real HTTP through SSH. IDs must belong to the dedicated fictitious fixture."""
import gzip, json, sys, urllib.request, urllib.error, http.cookiejar
base, email, outsider, doc = sys.argv[1:]
assert email.startswith('history-benchmark-') and outsider.startswith('history-benchmark-')
def client(email):
    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def send(path,data=None,headers=None):
        return opener.open(urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers={'Accept':'application/json','Content-Type':'application/json','X-CSRF-TOKEN':token[0], **(headers or {})}))
    token=[''];token[0]=json.load(send('/api/csrf-token'))['csrf_token']
    send('/api/auth/login',{'email':email,'password':'Fictitious12345'}).close()
    token[0]=json.load(send('/api/csrf-token'))['csrf_token']
    return send
owner=client(email); other=client(outsider)
history='/api/documents/'+doc+'/timeline'
page=json.load(owner(history+'?metadata=1'));event_id=page['events'][0]['id']
transport=[]
for query in ['?metadata=1', '?limit=100']:
    with owner(history+query, headers={'Accept-Encoding':'identity'}) as response:
        plain=response.read()
        assert 'private' in response.headers['Cache-Control'] and 'no-store' in response.headers['Cache-Control']
    with owner(history+query, headers={'Accept-Encoding':'gzip'}) as response:
        compressed=response.read()
        assert response.headers['Content-Encoding']=='gzip'
        assert response.headers['Vary']=='Accept-Encoding'
    assert gzip.decompress(compressed)==plain
    transport.append({'query':query,'plain_bytes':len(plain),'gzip_bytes':len(compressed),'exact':True})
for query in ['?metadata=1','?event_id='+str(event_id),'?snapshot_ids[]='+str(event_id)]:
    try: other(history+query);raise AssertionError('Other owner read allowed')
    except urllib.error.HTTPError as error: assert error.code==404
seal=json.load(owner('/api/documents/'+doc+'/seal',{}))
version=seal['version'];code=seal['certificate']['certificate_code']
assert json.load(owner('/api/verify/'+code))['valid']
# Reads at several positions cannot alter an already issued certificate.
owner(history+'?event_id='+str(event_id)).close()
assert json.load(owner('/api/verify/'+code))['valid']
print(json.dumps({'real_backend':True,'transport':transport,'permissions':'404 metadata/single/block','version_id':version['id'],'certificate_code':code,'seal_valid_before_and_after_read':True,'events_total':page['total']}))
