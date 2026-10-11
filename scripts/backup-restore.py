#!/usr/bin/env python3
"""Restricted, offline Docker backup/restore profile. No production defaults."""
import argparse, base64, hashlib, json, os, re, secrets, shutil, socket, subprocess, tarfile, time
from pathlib import Path
os.umask(0o077)
BASE=Path('/opt/inkgroove-backup-lab')

def run(args, **kw):
    return subprocess.run(args, check=True, **kw)
def output(args):
    return subprocess.check_output(args, text=True).strip()
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def root(value):
    p=Path(value)
    if not p.is_absolute() or p.parent!=BASE or not re.fullmatch(r'[a-z][a-z0-9-]{2,40}',p.name) or BASE.is_symlink() or p.is_symlink():
        raise ValueError('Directory must be a direct, non-symlink child of /opt/inkgroove-backup-lab')
    return p

def dc(p,*args,**kw):
    return run(['docker','compose','--env-file','/dev/null','--project-directory',str(p),'-p',metadata(p)['project'],'-f',str(p/'compose.json'),*args],**kw)
def metadata(p):
    m=json.loads((p/'installation.json').read_text())
    if m['root']!=str(p) or m['project']!='igbr-'+p.name or m['profile']!=1: raise ValueError('Installation identity mismatch')
    c=json.loads((p/'compose.json').read_text())
    app=c['services']['app'];db=c['services']['db']
    if set(c['services'])!={'app','db'} or app['volumes']!=['./code:/workspace'] or app['env_file']!=['./private/app.env'] or app['ports']!=[f"127.0.0.1:{m['port']}:80"] or app['image']!='inkgroove-dev-php:local' or db['image']!='inkgroove-dev-db:local' or db['volumes']!=['mysql:/var/lib/mysql','./private/app-password:/run/secrets/app-password:ro','./private/root-password:/run/secrets/root-password:ro','./private/client.cnf:/run/secrets/client.cnf:ro'] or db.get('ports') or db['environment']['MARIADB_DATABASE']!='inkgroove_backup':
        raise ValueError('Unexpected installation connections/mounts/services')
    for child in ['code','private']:
        if (p/child).is_symlink():raise ValueError('Unexpected installation symlink')
    return m

def free_names(p,port):
    project='igbr-'+p.name
    for kind in ['container','network','volume']:
        names=output(['docker',kind,'ls','--format','{{.Name}}' if kind!='container' else '{{.Names}}']).splitlines()
        if any(n==project or n.startswith(project+'-') or n.startswith(project+'_') for n in names): raise ValueError('Docker name already exists')
    s=socket.socket();s.bind(('127.0.0.1',port));s.close()
    return project

def init(p,port):
    if p.exists(): raise ValueError('Destination directory already exists (must be new)')
    project=free_names(p,port)
    for image in ['inkgroove-dev-php:local','inkgroove-dev-db:local']:
        output(['docker','image','inspect','--format','{{.Id}}',image])
    BASE.mkdir(mode=0o700,exist_ok=True);p.mkdir(mode=0o700)
    (p/'private').mkdir(mode=0o700);(p/'code').mkdir(mode=0o700)
    password=secrets.token_hex(32)
    (p/'private/app-password').write_text(password)
    (p/'private/root-password').write_text(secrets.token_hex(32))
    env='\n'.join(['APP_NAME=InkGroove','APP_ENV=local','APP_DEBUG=false',f'APP_URL=http://127.0.0.1:{port}','APP_KEY=base64:'+base64.b64encode(secrets.token_bytes(32)).decode(),'VERITAS_SIGNING_KEY='+secrets.token_hex(48),'DB_CONNECTION=mysql','DB_HOST=db','DB_PORT=3306','DB_DATABASE=inkgroove_backup','DB_USERNAME=inkgroove_backup','DB_PASSWORD='+password,'SESSION_DRIVER=database','SESSION_ENCRYPT=true','SESSION_COOKIE='+project.replace('-','_'),'SESSION_SECURE_COOKIE=false','CACHE_STORE=file','MAIL_MAILER=log','LOG_CHANNEL=single','LOG_LEVEL=warning',''])
    (p/'private/app.env').write_text(env)
    (p/'private/client.cnf').write_text('[client]\nuser=inkgroove_backup\npassword='+password+'\ndefault-character-set=utf8mb4\n')
    m={'profile':1,'root':str(p),'project':project,'port':port,'created_at':time.time()}
    (p/'installation.json').write_text(json.dumps(m,indent=2))
    compose={'services':{'db':{'image':'inkgroove-dev-db:local','environment':{'MARIADB_DATABASE':'inkgroove_backup','MARIADB_USER':'inkgroove_backup','MARIADB_PASSWORD_FILE':'/run/secrets/app-password','MARIADB_ROOT_PASSWORD_FILE':'/run/secrets/root-password'},'volumes':['mysql:/var/lib/mysql','./private/app-password:/run/secrets/app-password:ro','./private/root-password:/run/secrets/root-password:ro','./private/client.cnf:/run/secrets/client.cnf:ro'],'command':['--innodb-buffer-pool-size=96M','--max-connections=20'],'healthcheck':{'test':['CMD','healthcheck.sh','--connect','--innodb_initialized'],'interval':'2s','timeout':'5s','retries':60}},'app':{'image':'inkgroove-dev-php:local','working_dir':'/workspace','volumes':['./code:/workspace'],'env_file':['./private/app.env'],'ports':[f'127.0.0.1:{port}:80'],'command':['sh','-c','chown -R www-data:www-data storage bootstrap/cache && exec apache2-foreground'],'healthcheck':{'test':['CMD','curl','--fail','--silent','--output','/dev/null','http://127.0.0.1/up'],'interval':'2s','timeout':'5s','retries':60}}},'volumes':{'mysql':{}}}
    (p/'compose.json').write_text(json.dumps(compose,indent=2))
    for f in (p/'private').iterdir(): f.chmod(0o600)
    print('Created isolated installation:',project)

def stopped(p):
    project=metadata(p)['project']
    if output(['docker','ps','-q','--filter','label=com.docker.compose.project='+project]): raise ValueError('Destination is active')
def clean_runtime(code):
    for rel in ['bootstrap/cache','storage/framework/cache','storage/framework/sessions','storage/framework/views','storage/logs']:
        d=code/rel
        if d.exists():
            for f in d.iterdir():
                if f.name=='.gitkeep': continue
                if f.is_dir(): shutil.rmtree(f)
                else:f.unlink()
        d.mkdir(parents=True,exist_ok=True)
    (code/'storage/framework/cache/data').mkdir(exist_ok=True)

def archive_tree(out,source):
    with tarfile.open(out,'w:gz') as tar:
        for f in sorted(source.rglob('*')):
            rel=f.relative_to(source)
            if f.is_symlink(): raise ValueError('Symlinks unsupported: '+str(rel))
            if f.is_file():tar.add(f,arcname=str(rel),recursive=False)

def backup(p,b):
    metadata(p)
    if b.exists() or b.parent!=BASE or b.is_symlink(): raise ValueError('Backup must be a new private child of lab base')
    code=p/'code'
    for required in ['vendor/autoload.php','public/build/manifest.json','artisan','composer.lock','package-lock.json']:
        if not (code/required).is_file(): raise ValueError('Missing required source artifact: '+required)
    if any((code/f).exists() for f in ['.env','.git','.dev-private']):raise ValueError('Unexpected private source configuration')
    b.mkdir(mode=0o700);start=time.monotonic()
    # Stop every writer in this profile (only app); DB stays running for logical dump.
    dc(p,'stop','app')
    try:
        with (b/'database.sql').open('wb') as f:
            dc(p,'exec','-T','db','mariadb-dump','--defaults-extra-file=/run/secrets/client.cnf','--single-transaction','--skip-comments','--hex-blob','--routines','--triggers','--events','inkgroove_backup',stdout=f)
        archive_tree(b/'installation.tar.gz',code)
        shutil.copyfile(p/'private/app.env',b/'app.env')
        shutil.copyfile(code/'code-identity.json',b/'code-identity.json')
        manifest={'format':1,'consistency':'all profile writers stopped; database dump and files captured before restart','source':metadata(p),'images':{i:output(['docker','image','inspect','--format','{{.Id}}',i]) for i in ['inkgroove-dev-php:local','inkgroove-dev-db:local']},'files':{f.name:{'bytes':f.stat().st_size,'sha256':digest(f)} for f in b.iterdir()},'seconds':round(time.monotonic()-start,3)}
        (b/'manifest.json').write_text(json.dumps(manifest,indent=2))
        for f in b.iterdir():f.chmod(0o600)
        print(json.dumps({'backup':str(b),'bytes':sum(f.stat().st_size for f in b.iterdir()),'seconds':manifest['seconds']}))
    except BaseException:
        (b/'INCOMPLETE').touch();raise
    finally:
        dc(p,'start','app')

def validate(b):
    if b.is_symlink() or b.parent!=BASE:raise ValueError('Unauthorized backup directory')
    m=json.loads((b/'manifest.json').read_text())
    expected={'database.sql','installation.tar.gz','app.env','code-identity.json'}
    if m.get('format')!=1 or set(m['files'])!=expected or {f.name for f in b.iterdir()}!=expected|{'manifest.json'}:raise ValueError('Incomplete or unexpected backup inventory')
    for name,info in m['files'].items():
        f=b/name
        if f.is_symlink() or not f.is_file() or f.stat().st_size!=info['bytes'] or digest(f)!=info['sha256']:raise ValueError('Corrupt backup artifact: '+name)
    for image,image_id in m['images'].items():
        if image not in ['inkgroove-dev-php:local','inkgroove-dev-db:local'] or output(['docker','image','inspect','--format','{{.Id}}',image])!=image_id:raise ValueError('Required runtime image unavailable or changed')
    config=dict(line.split('=',1) for line in (b/'app.env').read_text().splitlines() if '=' in line)
    if not config.get('APP_KEY') or not config.get('VERITAS_SIGNING_KEY') or config.get('VERITAS_MEDIA_PATH') or config.get('INKGROOVE_PUBLIC_PATH'):
        raise ValueError('Missing keys or unsupported external paths')
    with tarfile.open(b/'installation.tar.gz') as tar:
        names=set()
        for entry in tar.getmembers():
            path=Path(entry.name)
            if path.is_absolute() or '..' in path.parts or not entry.isfile() or entry.name in names or not entry.name or '\\' in entry.name:raise ValueError('Unsafe archive entry')
            names.add(entry.name)
        if not {'artisan','vendor/autoload.php','public/build/manifest.json','code-identity.json'}<=names:raise ValueError('Incomplete code archive')
    return m

def restore(b,p,port):
    start=time.monotonic();validate(b)
    if p.exists():raise ValueError('Destination must be nonexistent, empty and inactive')
    init(p,port)
    with tarfile.open(b/'installation.tar.gz') as tar:
        for entry in tar.getmembers():
            target=p/'code'/entry.name;target.parent.mkdir(parents=True,exist_ok=True)
            with tar.extractfile(entry) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst)
            target.chmod(entry.mode & 0o777)
    source=dict(line.split('=',1) for line in (b/'app.env').read_text().splitlines() if '=' in line)
    target=dict(line.split('=',1) for line in (p/'private/app.env').read_text().splitlines() if '=' in line)
    # Preserve every source setting/key except explicitly installation-specific connections.
    for key in ['DB_CONNECTION','DB_HOST','DB_PORT','DB_DATABASE','DB_USERNAME','DB_PASSWORD','APP_URL','SESSION_COOKIE']:
        source[key]=target[key]
    if source.get('VERITAS_MEDIA_PATH'):raise ValueError('External media path unsupported by this profile')
    (p/'private/app.env').write_text(''.join(k+'='+v+'\n' for k,v in source.items()))
    (p/'code').chmod(0o755)
    for directory in (p/'code').rglob('*'):
        if directory.is_dir(): directory.chmod(0o755)
    clean_runtime(p/'code')
    for directory in (p/'code').rglob('*'):
        if directory.is_dir(): directory.chmod(0o755)
    dc(p,'up','-d','--wait','db')
    with (b/'database.sql').open('rb') as f:dc(p,'exec','-T','db','mariadb','--defaults-extra-file=/run/secrets/client.cnf','inkgroove_backup',stdin=f)
    dc(p,'up','-d','--wait','app')
    print(json.dumps({'restored':str(p),'seconds':round(time.monotonic()-start,3)}))

def cleanup(p):
    m=metadata(p);project=m['project']
    # Explicit project-scoped deletion, not down -v or a global prune.
    dc(p,'down')
    names=output(['docker','volume','ls','--filter','label=com.docker.compose.project='+project,'--format','{{.Name}}']).splitlines()
    if any(n!=project+'_mysql' for n in names):raise ValueError('Unexpected volume; manual review required')
    for n in names:run(['docker','volume','rm',n])
    shutil.rmtree(p);print('Removed recorded installation:',project)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['init','backup','validate','restore','cleanup']);parser.add_argument('path');parser.add_argument('--backup');parser.add_argument('--port',type=int,default=18084);a=parser.parse_args()
    try:
        p=root(a.path)
        if a.action=='init':init(p,a.port)
        elif a.action=='backup':backup(p,root(a.backup))
        elif a.action=='validate':validate(p);print('Backup integrity and safe archive inventory valid')
        elif a.action=='restore':restore(root(a.backup),p,a.port)
        elif a.action=='cleanup':cleanup(p)
    except (ValueError,OSError,subprocess.CalledProcessError,KeyError,tarfile.TarError) as e:
        print('Refused or failed:',type(e).__name__,str(e) if not isinstance(e,subprocess.CalledProcessError) else 'External command failed');raise SystemExit(1)
