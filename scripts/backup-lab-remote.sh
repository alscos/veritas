#!/bin/sh
# Prepare an exact current-worktree lab source; never synchronize into an installation.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
name=${1:?Usage: sh scripts/backup-lab-remote.sh source-name port}
port=${2:?Port required}
case "$port" in *[!0-9]*|'') echo "Numeric localhost port required" >&2; exit 1;; esac
test "$port" -ge 1024 && test "$port" -le 65535
case "$name" in *[!a-z0-9-]*|'') exit 1;; esac
ssh inkgroove-alpine "test ! -e /opt/inkgroove-backup-lab/$name"
scp "$root/scripts/backup-restore.py" inkgroove-alpine:/tmp/inkgroove-backup-restore.py
ssh inkgroove-alpine "python3 /tmp/inkgroove-backup-restore.py init /opt/inkgroove-backup-lab/$name --port $port"
rsync -az --filter='+ /.env.example' --exclude='.env' --exclude='.env.*' --exclude='.git/' --exclude='.dev-private/' --exclude='.dev-backups/' --exclude='.aws/' --exclude='.codex/' --exclude='.agents/' --exclude='data/' --exclude='vendor/' --exclude='node_modules/' --exclude='/public/build/' --exclude='/storage/' --exclude='/bootstrap/cache/*.php' --exclude='*.sqlite*' --exclude='.phpunit*cache*' --exclude='coverage/' --exclude='releases/' --exclude='__pycache__/' --exclude='*.pyc' --exclude='.inkgroove-updates/' --exclude='.DS_Store' "$root/" "inkgroove-alpine:/opt/inkgroove-backup-lab/$name/code/"
# Public identity metadata only; archive captures actual files rather than relying on Git.
tmp=$(mktemp /tmp/igbr-identity.XXXXXX)
trap 'rm -f "$tmp"' EXIT
python3 - "$root" > "$tmp" <<'PY'
import json,subprocess,sys
p=sys.argv[1]
print(json.dumps({'commit':subprocess.check_output(['git','-C',p,'rev-parse','HEAD'],text=True).strip(),'branch':subprocess.check_output(['git','-C',p,'branch','--show-current'],text=True).strip(),'status':subprocess.check_output(['git','-C',p,'status','--porcelain'],text=True),'note':'Exact synchronized worktree including uncommitted files; runtime dependencies and assets captured in archive'}))
PY
scp "$tmp" "inkgroove-alpine:/opt/inkgroove-backup-lab/$name/code/code-identity.json"
