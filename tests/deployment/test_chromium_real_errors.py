"""Injected finalization tests: no Docker, HTTP, database or fixture recreation."""
import importlib.util
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

spec=importlib.util.spec_from_file_location('policy',Path(__file__).resolve().parents[2]/'scripts/chromium_real_errors.py')
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)

class FinalizationTests(unittest.TestCase):
    def state(self):
        return {'consumed_seconds':25,'budget_seconds':600,'trial_passed':False,
                'failure':'original browser failure','original_browser_failure':{'step':'moviola.revision_unchanged'}},SimpleNamespace(STOP=threading.Event())

    def test_functional_failure_audits_before_cleanup_and_preserves_original(self):
        ledger,guard=self.state();calls=[]
        def audit():calls.append('audit');return {'events_verified':1805}
        def clean():calls.append('cleanup');ledger['cleanup_verified']=True
        policy.finalize(ledger,guard,True,True,audit,clean)
        self.assertEqual(calls,['audit','cleanup']);self.assertEqual(ledger['integrity_status']['state'],'passed')
        self.assertEqual(ledger['failure'],'original browser failure');self.assertFalse(ledger['trial_passed'])
        self.assertEqual(ledger['original_browser_failure']['step'],'moviola.revision_unchanged')

    def test_guard_never_audits_but_cleans(self):
        ledger,guard=self.state();guard.STOP.set();audit=Mock();clean=Mock()
        policy.finalize(ledger,guard,True,True,audit,clean)
        audit.assert_not_called();clean.assert_called_once();self.assertEqual(ledger['integrity_status']['reason'],'active_guard')

    def test_exhausted_budget_never_audits_but_cleans(self):
        ledger,guard=self.state();ledger['consumed_seconds']=600;audit=Mock();clean=Mock()
        policy.finalize(ledger,guard,True,True,audit,clean)
        audit.assert_not_called();clean.assert_called_once();self.assertEqual(ledger['integrity_status']['reason'],'budget_exhausted')

    def test_tiny_remaining_budget_cannot_start_unbounded_php_audit(self):
        ledger,guard=self.state();ledger['consumed_seconds']=599;audit=Mock();clean=Mock()
        policy.finalize(ledger,guard,True,True,audit,clean)
        audit.assert_not_called();clean.assert_called_once();self.assertEqual(ledger['integrity_status']['reason'],'insufficient_budget_for_bounded_audit')

    def test_unknown_browser_closure_keeps_audit_pending(self):
        ledger,guard=self.state();audit=Mock();clean=Mock()
        policy.finalize(ledger,guard,True,False,audit,clean)
        audit.assert_not_called();clean.assert_called_once();self.assertEqual(ledger['integrity_status']['reason'],'browser_closure_not_confirmed')

    def test_unconfirmed_fixture_is_not_audited(self):
        ledger,guard=self.state();audit=Mock();clean=Mock()
        policy.finalize(ledger,guard,False,True,audit,clean)
        audit.assert_not_called();clean.assert_called_once();self.assertEqual(ledger['integrity_status']['reason'],'fixture_not_confirmed')

    def test_audit_and_cleanup_errors_do_not_replace_browser_failure(self):
        ledger,guard=self.state();audit=Mock(side_effect=ValueError('private audit detail'));clean=Mock(side_effect=OSError('private cleanup detail'))
        policy.finalize(ledger,guard,True,True,audit,clean)
        clean.assert_called_once();self.assertEqual(ledger['failure'],'original browser failure')
        self.assertEqual(ledger['integrity_status']['error']['type'],'ValueError');self.assertEqual(ledger['cleanup_error']['type'],'OSError')
        self.assertFalse(ledger['cleanup_verified']);self.assertNotIn('private',str(ledger))

    def test_guard_activating_during_audit_keeps_original_and_cleans(self):
        ledger,guard=self.state();clean=Mock()
        def audit():guard.STOP.set();raise RuntimeError('stop')
        policy.finalize(ledger,guard,True,True,audit,clean)
        clean.assert_called_once();self.assertEqual(ledger['integrity_status']['pending_reason'],'guard_during_audit');self.assertEqual(ledger['failure'],'original browser failure')

    def test_budget_consumed_during_audit_keeps_original_and_cleans(self):
        ledger,guard=self.state();clean=Mock()
        def audit():ledger['consumed_seconds']=601;raise TimeoutError()
        policy.finalize(ledger,guard,True,True,audit,clean)
        clean.assert_called_once();self.assertEqual(ledger['integrity_status']['pending_reason'],'budget_during_audit')

    def test_successful_browser_cannot_pass_failed_audit(self):
        ledger,guard=self.state();ledger.pop('failure');ledger['trial_passed']=True
        policy.finalize(ledger,guard,True,True,Mock(side_effect=ValueError()),Mock())
        self.assertFalse(ledger['trial_passed']);self.assertEqual(ledger['failure'],'Integrity audit not completed')

    def test_cleanup_continues_owned_actions_after_failure(self):
        ledger,guard=self.state();calls=[]
        def broken():calls.append('fixture');raise OSError()
        def remove_probe():calls.append('probe')
        def health():calls.append('health')
        def clean():policy.cleanup_actions(ledger,[('fixture',broken),('probe',remove_probe),('health',health)])
        policy.finalize(ledger,guard,True,True,Mock(return_value={}),clean)
        self.assertEqual(calls,['fixture','probe','health']);self.assertFalse(ledger['cleanup_verified'])
        self.assertEqual(ledger['cleanup_errors'][0]['step'],'fixture');self.assertEqual(ledger['failure'],'original browser failure')

    def test_original_browser_failure_can_be_recovered_without_report_file(self):
        output='Docker chatter\n{"real_backend":true,"attempt":2,"passed":false,"browser_closed":true,"failure":{"step":"moviola.editor_html_unchanged"}}\n'
        report=policy.browser_report(output,2)
        self.assertEqual(report['failure']['step'],'moviola.editor_html_unchanged');self.assertTrue(report['browser_closed'])
        self.assertIsNone(policy.browser_report(output,1));self.assertIsNone(policy.browser_report('not JSON',2))

if __name__=='__main__':unittest.main()
