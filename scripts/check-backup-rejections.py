"""Controlled negative checks: only new children of the isolated lab base."""
import importlib.util, io, json, shutil, tarfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('backup',Path(__file__).with_name('backup-restore.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
base=b.BASE;source=base/'source-20261010';copy=base/'copy-final-20261010'
def refused(label,fn):
    try:fn()
    except (ValueError,OSError): print(label+': rejected');return
    raise RuntimeError(label+': unexpectedly accepted')
if (base/'destination-20261010').exists():
    refused('active restored destination',lambda:b.restore(copy,base/'destination-20261010',18085))
refused('existing destination',lambda:b.restore(copy,source,18084))
refused('development destination',lambda:b.root('/opt/veritas-dev'))
refused('path outside authorized root',lambda:b.root('/opt/inkgroove-backup-lab/../veritas'))
for kind in ['incomplete','corrupt','traversal']:
    p=base/('negative-'+kind+'-20261010')
    if p.exists():raise RuntimeError('Negative test path exists')
    shutil.copytree(copy,p)
    try:
        if kind=='incomplete':(p/'database.sql').unlink()
        elif kind=='corrupt':
            with (p/'database.sql').open('ab') as f:f.write(b'corruption')
        else:
            with tarfile.open(p/'installation.tar.gz','w:gz') as tar:
                entry=tarfile.TarInfo('../escape');entry.size=1;tar.addfile(entry,io.BytesIO(b'x'))
            m=json.loads((p/'manifest.json').read_text());f=p/'installation.tar.gz';m['files'][f.name]={'bytes':f.stat().st_size,'sha256':b.digest(f)};(p/'manifest.json').write_text(json.dumps(m))
        refused(kind+' backup',lambda:b.validate(p))
    finally:shutil.rmtree(p)
assert not (base/'escape').exists()
print('All controlled rejection checks passed; no destination created')
