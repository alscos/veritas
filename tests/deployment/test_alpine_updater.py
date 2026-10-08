"""Exercise the real shell/PHP updater with Docker operations simulated locally.

No real DB/container is claimed by these tests; CI separately builds the runtime.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

REPO = Path(__file__).resolve().parents[2]
PHP = os.environ.get("PHP_BIN", "php")
REVISION = "1234567890abcdef1234567890abcdef12345678"

DOCKER_STUB = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
root = pathlib.Path(os.environ["TEST_ROOT"])
args = sys.argv[1:]
with (root / "docker-operations.jsonl").open("a") as file:
    file.write(json.dumps(args) + "\n")
if args[0] == "inspect":
    print("sha256:previous-image")
elif args[0] == "run":
    index = next(i for i, a in enumerate(args) if a.startswith("/workspace/") and a.endswith(".php"))
    command = [os.environ["PHP_BIN"]] + [a.replace("/workspace/", str(root) + "/") for a in args[index:]]
    env = dict(os.environ, INKGROOVE_WORKSPACE=str(root))
    result = subprocess.run(command, env=env)
    sys.exit(result.returncode)
elif args[0] == "build":
    if os.environ.get("TEST_FAIL") == "build": sys.exit(1)
elif args[:2] == ["image", "tag"]:
    pass
elif args[0] == "compose":
    if "db" in args and "exec" in args:
        if os.environ.get("TEST_FAIL") == "backup": sys.exit(1)
        print("-- consistent SQL dump")
    elif "artisan" in args:
        op = args[args.index("artisan") + 1]
        flag = root / "storage/framework/down"
        if op == "down":
            flag.parent.mkdir(parents=True, exist_ok=True)
            flag.write_text("maintenance")
        elif op == "up":
            flag.unlink(missing_ok=True)
        elif op == "migrate:status" and os.environ.get("TEST_FAIL") == "migration":
            sys.exit(1)
    elif "up" in args:
        assert (root / "data/app/deploy-maintenance").exists(), "Maintenance must survive container replacement"
    elif "php" in args or "ps" in args:
        pass
    else:
        raise RuntimeError(args)
else:
    raise RuntimeError(args)
'''


class AlpineUpdaterTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="inkgroove-alpine-test-")
        self.base = Path(self.temporary.name)
        self.root = self.base / "app"
        self.root.mkdir()
        self.bin = self.base / "bin"
        self.bin.mkdir()
        stub = self.bin / "docker"
        stub.write_text(DOCKER_STUB)
        stub.chmod(0o755)
        shutil.copytree(REPO / "deploy", self.root / "deploy")
        shutil.copytree(REPO / "scripts", self.root / "scripts")
        (self.root / "compose.yaml").write_text("old compose")
        (self.root / ".env").write_text("DB_PASSWORD=keep-private-host-password\n")
        (self.root / "old-managed.php").write_text("removed code")
        (self.root / "FILES.sha256").write_text("a" * 64 + "  old-managed.php\n")
        images = self.root / "data/app/images"
        images.mkdir(parents=True)
        (images / "drawing.png").write_bytes(b"private-image")
        (self.root / "data/app/veritas.env").write_text("APP_KEY=keep-app-key\nVERITAS_SIGNING_KEY=keep-seal-key\n")
        config = self.root / "data/app/update/config.json"
        config.parent.mkdir()
        config.write_text(json.dumps({"repository": "alscos/veritas", "token": "private-test-token"}))
        self.archive = self.base / "package.zip"
        self.files = {
            "BUILD-INFO.json": json.dumps({"profile": "alpine", "candidate": False, "revision": REVISION}),
            "Dockerfile": "new runtime",
            "compose.yaml": "new compose with fixed image tag",
            "app/new.php": "new source",
        }
        manifest = "".join(hashlib.sha256(value.encode()).hexdigest() + "  " + name + "\n" for name, value in self.files.items())
        with zipfile.ZipFile(self.archive, "w") as zip:
            for name, body in self.files.items(): zip.writestr(name, body)
            zip.writestr("FILES.sha256", manifest)
        self.hash = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.env = dict(os.environ, TEST_ROOT=str(self.root), PHP_BIN=PHP, VERITAS_DIR=str(self.root), VERITAS_BACKUP_DIR=str(self.base), PATH=str(self.bin) + ":" + os.environ["PATH"])

    def tearDown(self): self.temporary.cleanup()

    def run_update(self, fail="", checksum=None):
        return subprocess.run(["sh", str(self.root / "scripts/update-alpine.sh"), "install", str(self.archive), checksum or self.hash], env=dict(self.env, TEST_FAIL=fail), capture_output=True, text=True)

    def test_success_preserves_persistent_data_and_removes_only_old_managed_source(self):
        result = self.run_update()
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual("DB_PASSWORD=keep-private-host-password\n", (self.root / ".env").read_text())
        self.assertIn("keep-app-key", (self.root / "data/app/veritas.env").read_text())
        self.assertIn("keep-seal-key", (self.root / "data/app/veritas.env").read_text())
        self.assertEqual(b"private-image", (self.root / "data/app/images/drawing.png").read_bytes())
        self.assertFalse((self.root / "old-managed.php").exists())
        self.assertEqual("new source", (self.root / "app/new.php").read_text())
        self.assertFalse((self.root / "data/app/deploy-maintenance").exists())
        self.assertFalse((self.root / "data/app/update/deploy-lock").exists())
        self.assertEqual(REVISION, (self.root / "data/app/update/installed-revision").read_text().strip())
        backup = next(self.base.glob("inkgroove-backup-*"))
        self.assertTrue((backup / "database.sql").stat().st_size > 0)
        self.assertTrue((backup / "app-data.tar.gz").exists())
        self.assertEqual(0o700, backup.stat().st_mode & 0o777)
        result = self.run_update()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("ya está instalada", result.stdout)

    def test_wrong_checksum_does_not_build_or_touch_current_source(self):
        result = self.run_update(checksum="0" * 64)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("SHA256", result.stderr)
        self.assertEqual("old compose", (self.root / "compose.yaml").read_text())
        self.assertFalse((self.root / "data/app/deploy-maintenance").exists())
        self.assertNotIn('"build"', (self.root / "docker-operations.jsonl").read_text())

    def test_build_failure_leaves_current_app_available(self):
        result = self.run_update(fail="build")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("old compose", (self.root / "compose.yaml").read_text())
        self.assertFalse((self.root / "data/app/deploy-maintenance").exists())

    def test_backup_failure_reopens_old_app_without_activating_new_image(self):
        result = self.run_update(fail="backup")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("old compose", (self.root / "compose.yaml").read_text())
        self.assertFalse((self.root / "data/app/deploy-maintenance").exists())
        self.assertFalse((self.root / "storage/framework/down").exists())

    def test_failure_after_activation_keeps_maintenance_and_backup(self):
        result = self.run_update(fail="migration")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("sigue en mantenimiento", result.stderr)
        self.assertTrue((self.root / "data/app/deploy-maintenance").exists())
        self.assertTrue((self.root / "storage/framework/down").exists())
        self.assertFalse((self.root / "data/app/update/installed-revision").exists())
        self.assertTrue(next(self.base.glob("inkgroove-backup-*/database.sql")).exists())


if __name__ == "__main__": unittest.main()
