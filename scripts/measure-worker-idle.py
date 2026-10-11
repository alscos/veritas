"""Bounded dev-only KeepAlive diagnostic; no login, cookies or document writes.

Run each configuration separately. Uses the existing capacity monitor/guards.
X-Bottleneck-Probe allows a temporary PHP timing probe to select our requests.
"""
import http.client
import importlib.util
import json
from pathlib import Path
import socket
import threading
import time

if Path.cwd() != Path('/opt/veritas-dev'):
    raise SystemExit('Development root only')
spec = importlib.util.spec_from_file_location('load', 'scripts/measure-capacity.py')
load = importlib.util.module_from_spec(spec)
spec.loader.exec_module(load)
monitor = threading.Thread(target=load.monitor)
monitor.start()
rows = []
start = time.monotonic()
try:
    time.sleep(3)
    for _ in range(3):
        if load.STOP.is_set() or time.monotonic() - start > 30:
            raise RuntimeError('Guard stopped diagnostic')
        with socket.create_connection(('127.0.0.1', 8083), timeout=3) as holder:
            holder.sendall(b'GET /up HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\nX-Bottleneck-Probe: 1\r\n\r\n')
            response = http.client.HTTPResponse(holder)
            response.begin()
            response.read()
            if response.status != 200 or response.getheader('Set-Cookie'):
                raise RuntimeError('Unexpected health response/session')
            connection = response.getheader('Connection')
            # Release before either health timeout; always join/close our socket.
            release = threading.Timer(0.6, holder.close)
            release.start()
            try:
                before = time.monotonic()
                client = http.client.HTTPConnection('127.0.0.1', 8083, timeout=3)
                try:
                    client.request('GET', '/up', headers={'Connection': 'close', 'X-Bottleneck-Probe': '1'})
                    waiting = client.getresponse()
                    waiting.read()
                    if waiting.status != 200 or waiting.getheader('Set-Cookie'):
                        raise RuntimeError('Unexpected queued response/session')
                    rows.append({'connection': connection, 'request_ms': round((time.monotonic()-before)*1000, 2)})
                finally:
                    client.close()
            finally:
                release.join()
        if load.STOP.wait(1):
            raise RuntimeError('Guard stopped diagnostic')
finally:
    load.STOP.set()
    monitor.join(timeout=15)
    print(json.dumps({'requests': rows, 'stop': load.REASON, 'elapsed_seconds': round(time.monotonic()-start, 2),
        'available_min_mib': min((r['available_kib']/1024 for r in load.SAMPLES), default=None),
        'existing_health_max_ms': max((r['existing_health'][1] for r in load.SAMPLES), default=None),
        'dev_health_failures': sum(not r['dev_health'][0] for r in load.SAMPLES),
        'samples': len(load.SAMPLES)}))
