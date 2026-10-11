"""Create dev-only secrets once, without printing values or replacing keys."""
import base64
import os
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
if root != Path('/opt/veritas-dev'):
    raise SystemExit('Run only in /opt/veritas-dev.')
os.umask(0o077)
private = root / '.dev-private'
private.mkdir(mode=0o700, exist_ok=True)
private.chmod(0o700)

def persist(name, factory):
    target = private / name
    if not target.exists():
        with target.open('x') as stream:
            stream.write(factory())
    target.chmod(0o600)
    return target.read_text().strip()

app_password = persist('app-password', lambda: secrets.token_hex(32))
smoke_password = persist('smoke-password', lambda: secrets.token_hex(32))
persist('root-password', lambda: secrets.token_hex(32))

def environment(database, password):
    return '\n'.join([
        'APP_NAME=InkGroove', 'APP_ENV=local', 'APP_DEBUG=false',
        'APP_URL=http://localhost:8083',
        'APP_KEY=base64:' + base64.b64encode(secrets.token_bytes(32)).decode(),
        'VERITAS_SIGNING_KEY=' + secrets.token_hex(48),
        'DB_CONNECTION=mysql', 'DB_HOST=db', 'DB_PORT=3306',
        'DB_DATABASE=' + database, 'DB_USERNAME=' + database,
        'DB_PASSWORD=' + password, 'SESSION_DRIVER=database',
        'SESSION_ENCRYPT=true', 'SESSION_SECURE_COOKIE=false',
        'SESSION_COOKIE=inkgroove_dev_session', 'CACHE_STORE=file',
        'LOG_CHANNEL=single', 'LOG_LEVEL=warning', '',
    ])

persist('app.env', lambda: environment('inkgroove_dev', app_password))
persist('smoke.env', lambda: environment('inkgroove_check', smoke_password))
for directory in ['storage/app/private/images', 'storage/framework/cache/data',
                  'storage/framework/sessions', 'storage/framework/views',
                  'storage/logs', 'bootstrap/cache']:
    (root / directory).mkdir(parents=True, exist_ok=True)
print('Dev secrets and Laravel directories ready (existing keys preserved).')
