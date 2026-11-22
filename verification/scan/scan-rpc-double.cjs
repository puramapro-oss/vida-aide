// Controlled persistence boundary for route tests. PostgreSQL's real locking,
// grants and rollback are checked independently by the SQL/native CI gates.
const { isDeepStrictEqual } = require('node:util');
const clone = (v) => structuredClone(v);
function createScanRpcDouble(state, calls) {
  state.scans ||= new Map();
  function response(outcome, extra = {}) { return { data: { version: 1, outcome, ...extra }, error: null }; }
  function identity(scan, args, profile) {
    return scan.user_id === profile.id && scan.type === args.p_type
      && isDeepStrictEqual(scan.input_data, args.p_input_data);
  }
  return async function rpc(name, args) {
    const profile = state.profileResult.data;
    if (!profile || profile.auth_user_id !== args.p_auth_user_id) return response('profile_missing');
    const plan = profile.role === 'super_admin' ? 'premium' : profile.subscription_plan;
    const current = state.scans.get(args.p_request_id);
    if (current && !identity(current, args, profile)) return response('conflict');
    if (current?.status === 'processing' && current.processing_expires_at && Date.parse(current.processing_expires_at) <= Date.now()) {
      current.status = 'failed'; current.failure_code = 'result_unconfirmed';
    }
    if (name === 'reserve_scan_v1') {
      if (current) return response(current.status === 'processing' ? 'in_progress' : current.status, { plan, scan: clone(current) });
      const quota = state.quotaResult;
      if (plan === 'free') {
        if (quota.error || typeof quota.count !== 'number' || !Number.isSafeInteger(quota.count) || quota.count < 0) {
          return { data: null, error: { message: 'fixture quota unavailable' } };
        }
        const used = quota.count + [...state.scans.values()].filter((s) => s.user_id === profile.id && Date.parse(s.created_at) >= Date.now() - 86400000).length;
        if (used >= 5) return response('quota_exceeded', { limit: 5, used });
      }
      const scan = {
        id: args.p_request_id, user_id: profile.id, type: args.p_type, input_data: clone(args.p_input_data),
        results: [], total_recoverable: 0, total_recoverable_monthly: 0, ai_summary: null,
        status: 'processing', failure_code: null, created_at: new Date().toISOString(),
        processing_expires_at: new Date(Date.now() + 300000).toISOString(),
      };
      state.scans.set(scan.id, scan);
      calls.inserts.push({ table: 'scans', data: clone(scan) });
      const reply = response('reserved', { plan, scan: clone(scan) });
      return state.reservationReply ? state.reservationReply(reply, args) : reply;
    }
    if (name !== 'finish_scan_v1') throw new Error(`Unexpected fixture RPC: ${name}`);
    if (!current) return response('not_found');
    if (current.status !== 'processing') return response(current.status, { changed: false, scan: clone(current) });
    if (!current.processing_expires_at) return response('legacy_unconfirmed');
    if (args.p_failure_code) {
      current.status = 'failed'; current.failure_code = args.p_failure_code;
      calls.failures.push({ id: current.id, code: args.p_failure_code });
      return response('failed', { changed: true, scan: clone(current) });
    }
    const result = args.p_result;
    Object.assign(current, {
      status: 'completed', results: clone(result.results), total_recoverable: result.total_recoverable,
      total_recoverable_monthly: result.total_recoverable_monthly, ai_summary: result.summary,
    });
    calls.finalizations.push({ id: current.id, result: clone(result) });
    state.savedProfile.xp = Math.max(state.savedProfile.xp, 100);
    let receipt = { data: clone(current), error: null };
    if (typeof state.scanReply === 'function') receipt = await state.scanReply(clone(current), args);
    else if (state.scanReply) receipt = state.scanReply;
    const reply = { data: receipt.data ? { version: 1, outcome: 'completed', changed: true, scan: receipt.data } : null, error: receipt.error };
    return state.finishReply ? state.finishReply(reply, args) : reply;
  };
}
module.exports = { createScanRpcDouble };
