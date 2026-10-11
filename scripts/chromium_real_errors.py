"""Pure finalization policy. Injected actions only; import never accesses Docker/data."""
import json

def browser_report(output, attempt):
    """Recover the owned JSON if report-file writing failed; ignore Docker chatter."""
    for line in reversed(output.splitlines()):
        try:value=json.loads(line)
        except (ValueError,TypeError):continue
        if isinstance(value,dict) and value.get('real_backend') is True and value.get('attempt')==attempt and isinstance(value.get('passed'),bool):
            return value
    return None

def error_info(error):
    # Phase names are fixed by the caller. Never serialize raw subprocess output.
    return {'type':type(error).__name__, 'phase':getattr(error,'phase',None),
            'exit_code':getattr(error,'exit_code',None)}

def cleanup_actions(ledger, actions):
    """Try every owned cleanup action; don't discard the manifest after failure."""
    errors=[]
    for step, action in actions:
        try:action()
        except Exception as error:errors.append({'step':step,'error':error_info(error)})
    if errors:
        ledger['cleanup_errors']=errors
        raise RuntimeError('Scoped cleanup incomplete')

def finalize(ledger, guard, fixture_ready, browser_closed, audit, cleanup):
    """Audit after the closed browser when allowed; always attempt scoped cleanup.

    The original functional failure is never replaced by audit/cleanup failure.
    Monitor STOP is NOT set here: its live guard can still interrupt the audit.
    """
    if not fixture_ready:
        reason='fixture_not_confirmed'
    elif guard.STOP.is_set():
        reason='active_guard'
    elif ledger['consumed_seconds']>=ledger['budget_seconds']:
        reason='budget_exhausted'
    elif ledger['budget_seconds']-ledger['consumed_seconds']<2:
        reason='insufficient_budget_for_bounded_audit'
    elif not browser_closed:
        reason='browser_closure_not_confirmed'
    else:
        reason=None
    ledger['integrity_status']={'state':'pending','reason':reason}
    if reason is None:
        try:
            ledger['integrity']=audit()
            ledger['integrity_status']={'state':'passed'}
        except Exception as error:
            ledger['integrity_status']={'state':'failed','error':error_info(error)}
            if guard.STOP.is_set():ledger['integrity_status']['pending_reason']='guard_during_audit'
            elif ledger['consumed_seconds']>=ledger['budget_seconds']:ledger['integrity_status']['pending_reason']='budget_during_audit'
    if ledger['integrity_status']['state']!='passed':
        ledger['trial_passed']=False
        ledger.setdefault('failure','Integrity audit not completed')
    try:
        cleanup()
    except Exception as error:
        ledger['cleanup_verified']=False
        ledger['cleanup_error']=error_info(error)
        ledger.setdefault('failure','Cleanup failed')
    # Deliberately return all failures; a caller must not claim success from cleanup alone.
    return ledger
