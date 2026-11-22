-- Reserve the existing scan before any paid model call. An uncertain attempt
-- remains in the rolling quota; expiration never authorizes a provider retry.
BEGIN;

ALTER TABLE vida_aide.scans
  ADD COLUMN IF NOT EXISTS processing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_code text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'vida_aide.scans'::regclass
      AND attname = 'processing_expires_at' AND atttypid = 'timestamptz'::regtype AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'vida_aide.scans'::regclass
      AND attname = 'failure_code' AND atttypid = 'text'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Incompatible scan reservation columns';
  END IF;
END; $$;
CREATE INDEX IF NOT EXISTS scans_profile_quota_idx
  ON vida_aide.scans (user_id, created_at);
CREATE INDEX IF NOT EXISTS scans_profile_processing_expiry_idx
  ON vida_aide.scans (user_id, processing_expires_at)
  WHERE status = 'processing' AND processing_expires_at IS NOT NULL;

-- Current web/native clients only SELECT scans. Creation, finalization and
-- account deletion use the server; keep the existing SELECT/RLS policies.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE vida_aide.scans FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION vida_aide.reserve_scan_v1(
  p_auth_user_id uuid, p_request_id uuid, p_type text, p_input_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vida_aide
AS $$
DECLARE
  v_profile vida_aide.profiles%ROWTYPE;
  v_scan vida_aide.scans%ROWTYPE;
  v_now timestamptz;
  v_plan text;
  v_count bigint;
BEGIN
  IF p_auth_user_id IS NULL OR p_request_id IS NULL
     OR p_type IS NULL OR p_type NOT IN ('financial', 'fiscal', 'forgotten_money')
     OR jsonb_typeof(p_input_data) IS DISTINCT FROM 'object'
     OR octet_length(p_input_data::text) > 8192 THEN
    RAISE EXCEPTION 'Invalid scan reservation' USING ERRCODE = '22023';
  END IF;

  -- All admission/finalization paths take this same owner lock first.
  SELECT * INTO v_profile FROM vida_aide.profiles
    WHERE auth_user_id = p_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('version', 1, 'outcome', 'profile_missing'); END IF;
  v_now := clock_timestamp();
  v_plan := CASE WHEN v_profile.role = 'super_admin' THEN 'premium' ELSE v_profile.subscription_plan END;
  IF v_plan IS NULL OR v_plan NOT IN ('free', 'premium') THEN
    RAISE EXCEPTION 'Invalid scan entitlement' USING ERRCODE = '22023';
  END IF;

  -- At most 50 unrelated stale attempts per admission. Old rows without a
  -- service lease are historical data and are not reclassified by this sweep.
  UPDATE vida_aide.scans SET status = 'failed', failure_code = 'result_unconfirmed'
    WHERE id IN (
      SELECT id FROM vida_aide.scans WHERE user_id = v_profile.id
        AND status = 'processing' AND processing_expires_at <= v_now
      ORDER BY processing_expires_at, id LIMIT 50
    );

  SELECT * INTO v_scan FROM vida_aide.scans WHERE id = p_request_id;
  IF FOUND THEN
    IF v_scan.user_id <> v_profile.id OR v_scan.type <> p_type
       OR v_scan.input_data IS DISTINCT FROM p_input_data THEN
      RETURN jsonb_build_object('version', 1, 'outcome', 'conflict');
    END IF;
    -- The requested expired attempt is closed even when the bounded sweep was full.
    IF v_scan.status = 'processing' AND v_scan.processing_expires_at <= v_now THEN
      UPDATE vida_aide.scans SET status = 'failed', failure_code = 'result_unconfirmed'
        WHERE id = v_scan.id RETURNING * INTO v_scan;
    END IF;
    RETURN jsonb_build_object('version', 1, 'outcome',
      CASE v_scan.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'in_progress' END,
      'plan', v_plan, 'scan', to_jsonb(v_scan));
  END IF;

  IF v_plan = 'free' THEN
    SELECT count(*) INTO v_count FROM vida_aide.scans
      WHERE user_id = v_profile.id AND created_at >= v_now - interval '24 hours';
    IF v_count >= 5 THEN
      RETURN jsonb_build_object('version', 1, 'outcome', 'quota_exceeded', 'limit', 5, 'used', v_count);
    END IF;
  END IF;

  BEGIN
    INSERT INTO vida_aide.scans (
      id, user_id, type, input_data, results, total_recoverable,
      total_recoverable_monthly, ai_summary, status, created_at, processing_expires_at
    ) VALUES (
      p_request_id, v_profile.id, p_type, p_input_data, '[]'::jsonb, 0,
      0, NULL, 'processing', v_now, v_now + interval '5 minutes'
    ) RETURNING * INTO v_scan;
  EXCEPTION WHEN unique_violation THEN
    -- A simultaneous request by a different owner may have chosen the same UUID.
    RETURN jsonb_build_object('version', 1, 'outcome', 'conflict');
  END;
  RETURN jsonb_build_object('version', 1, 'outcome', 'reserved', 'plan', v_plan, 'scan', to_jsonb(v_scan));
END;
$$;

CREATE OR REPLACE FUNCTION vida_aide.finish_scan_v1(
  p_auth_user_id uuid, p_request_id uuid, p_type text, p_input_data jsonb,
  p_result jsonb DEFAULT NULL, p_failure_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vida_aide
AS $$
DECLARE
  v_profile_id uuid;
  v_scan vida_aide.scans%ROWTYPE;
  v_now timestamptz;
  v_annual numeric;
  v_monthly numeric;
BEGIN
  IF p_auth_user_id IS NULL OR p_request_id IS NULL
     OR (p_result IS NULL) = (p_failure_code IS NULL) THEN
    RAISE EXCEPTION 'Invalid scan finalization' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_profile_id FROM vida_aide.profiles
    WHERE auth_user_id = p_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('version', 1, 'outcome', 'profile_missing'); END IF;
  v_now := clock_timestamp();
  SELECT * INTO v_scan FROM vida_aide.scans WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('version', 1, 'outcome', 'not_found'); END IF;
  IF v_scan.user_id <> v_profile_id OR v_scan.type IS DISTINCT FROM p_type
     OR v_scan.input_data IS DISTINCT FROM p_input_data THEN
    RETURN jsonb_build_object('version', 1, 'outcome', 'conflict');
  END IF;
  IF v_scan.status <> 'processing' THEN
    RETURN jsonb_build_object('version', 1, 'outcome', v_scan.status, 'changed', false, 'scan', to_jsonb(v_scan));
  END IF;
  IF v_scan.processing_expires_at IS NULL THEN
    RETURN jsonb_build_object('version', 1, 'outcome', 'legacy_unconfirmed');
  END IF;
  IF v_scan.processing_expires_at <= v_now THEN
    UPDATE vida_aide.scans SET status = 'failed', failure_code = 'result_unconfirmed'
      WHERE id = p_request_id RETURNING * INTO v_scan;
    RETURN jsonb_build_object('version', 1, 'outcome', 'failed', 'changed', true, 'scan', to_jsonb(v_scan));
  END IF;

  IF p_failure_code IS NOT NULL THEN
    IF p_failure_code NOT IN ('provider_unavailable', 'provider_timeout', 'invalid_model_result', 'result_unconfirmed') THEN
      RAISE EXCEPTION 'Invalid scan failure code' USING ERRCODE = '22023';
    END IF;
    UPDATE vida_aide.scans SET status = 'failed', failure_code = p_failure_code
      WHERE id = p_request_id RETURNING * INTO v_scan;
    RETURN jsonb_build_object('version', 1, 'outcome', 'failed', 'changed', true, 'scan', to_jsonb(v_scan));
  END IF;

  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result->'results') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result->'summary') IS DISTINCT FROM 'string'
     OR btrim(p_result->>'summary') = ''
     OR jsonb_typeof(p_result->'total_recoverable') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_result->'total_recoverable_monthly') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid scan result' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_result->'results') AS item WHERE
      jsonb_typeof(item->'montant_estime') IS DISTINCT FROM 'number'
      OR item->>'unite' IS NULL OR item->>'unite' NOT IN ('mois', 'an', 'unique')) THEN
    RAISE EXCEPTION 'Invalid scan result periods' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_result->'results') AS item
      WHERE (item->>'montant_estime')::numeric < 0 OR (item->>'montant_estime')::numeric > 9999999999.99)
     OR (p_result->>'total_recoverable')::numeric NOT BETWEEN 0 AND 9999999999.99
     OR (p_result->>'total_recoverable_monthly')::numeric NOT BETWEEN 0 AND 9999999999.99 THEN
    RAISE EXCEPTION 'Invalid scan estimate amount' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(sum(round((item->>'montant_estime')::numeric * 100)
      * CASE WHEN item->>'unite' = 'mois' THEN 12 ELSE 1 END), 0),
    coalesce(sum(CASE WHEN item->>'unite' = 'mois' THEN round((item->>'montant_estime')::numeric * 100) ELSE 0 END), 0)
    INTO v_annual, v_monthly FROM jsonb_array_elements(p_result->'results') AS item;
  IF abs(round((p_result->>'total_recoverable')::numeric * 100) - v_annual) > 1
     OR abs(round((p_result->>'total_recoverable_monthly')::numeric * 100) - v_monthly) > 1 THEN
    RAISE EXCEPTION 'Incoherent scan estimate totals' USING ERRCODE = '22023';
  END IF;

  UPDATE vida_aide.scans SET status = 'completed', results = p_result->'results',
    total_recoverable = (p_result->>'total_recoverable')::numeric,
    total_recoverable_monthly = (p_result->>'total_recoverable_monthly')::numeric,
    ai_summary = p_result->>'summary', failure_code = NULL
    WHERE id = p_request_id RETURNING * INTO v_scan;
  -- Preserve the original first-scan floor without overwriting an existing or
  -- concurrent higher progression. Replays return above without awarding again.
  UPDATE vida_aide.profiles SET xp = greatest(xp, 100) WHERE id = v_profile_id;
  RETURN jsonb_build_object('version', 1, 'outcome', 'completed', 'changed', true, 'scan', to_jsonb(v_scan));
END;
$$;

REVOKE ALL ON FUNCTION vida_aide.reserve_scan_v1(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vida_aide.finish_scan_v1(uuid, uuid, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vida_aide.reserve_scan_v1(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION vida_aide.finish_scan_v1(uuid, uuid, text, jsonb, jsonb, text) TO service_role;

DO $$
DECLARE column_name text;
BEGIN
  IF has_table_privilege('authenticated', 'vida_aide.scans', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('anon', 'vida_aide.scans', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Unexpected inherited client scan privileges';
  END IF;
  IF has_function_privilege('authenticated', 'vida_aide.reserve_scan_v1(uuid,uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'vida_aide.reserve_scan_v1(uuid,uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'vida_aide.finish_scan_v1(uuid,uuid,text,jsonb,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'vida_aide.finish_scan_v1(uuid,uuid,text,jsonb,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected inherited scan RPC privileges';
  END IF;
  FOR column_name IN SELECT attname FROM pg_attribute
    WHERE attrelid = 'vida_aide.scans'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    IF has_column_privilege('authenticated', 'vida_aide.scans', column_name, 'INSERT,UPDATE,REFERENCES')
       OR has_column_privilege('anon', 'vida_aide.scans', column_name, 'INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Unexpected client scan column privileges';
    END IF;
  END LOOP;
END;
$$;
COMMIT;
