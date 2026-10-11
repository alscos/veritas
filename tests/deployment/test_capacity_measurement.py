"""Guard regressions without touching Docker, HTTP or application data."""
import importlib.util
import pathlib
import threading
import unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2]

class CapacityGuards(unittest.TestCase):
    def module(self):
        spec=importlib.util.spec_from_file_location('capacity',ROOT/'scripts/measure-capacity.py')
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        return m
    def test_low_available_memory_stops_before_load(self):
        m=self.module()
        mem='MemAvailable: 500000 kB\nSwapTotal: 8000000 kB\nSwapFree: 6000000 kB\n'
        with patch.object(m,'health',return_value=(True,5)),patch.object(m,'processes',return_value={'ticks':0}),patch.object(m.Path,'read_text',return_value=mem):
            m.monitor()
        self.assertTrue(m.STOP.is_set());self.assertEqual(m.REASON,['MemAvailable below 600 MiB'])
    def test_existing_installation_health_blocks_generator(self):
        m=self.module()
        with patch.object(m,'health',return_value=(False,3000)),patch.object(m,'processes') as processes:
            m.monitor()
        processes.assert_not_called()
        self.assertTrue(m.STOP.is_set());self.assertIn('unhealthy before load',m.REASON[0])
    def test_csrf_throttle_never_sends_login_without_token(self):
        m=self.module();c=m.Client({'id':999999,'email':'fiction@example.test'})
        with patch.object(c,'request',return_value=(429,{})) as call:
            code,_=c.login()
        self.assertEqual(code,429);self.assertEqual(call.call_count,1)

    def test_login_refreshes_rotated_csrf_before_writes(self):
        m=self.module();c=m.Client({'id':999999,'email':'fiction@example.test'})
        responses=[(200,{'csrf_token':'before'}),(200,{'user':{'id':999999}}),(200,{'csrf_token':'after'})]
        with patch.object(c,'request',side_effect=responses),patch.object(c.jar,'save'),patch.object(m.os,'chmod'):
            code,_=c.login()
        self.assertEqual(code,200);self.assertEqual(c.token,'after')

    def test_never_reports_more_writers_than_actual_clients(self):
        m=self.module()
        with self.assertRaises(ValueError):m.run_level([],None,30)

if __name__=='__main__':unittest.main()
