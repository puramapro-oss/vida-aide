CREATE FUNCTION scan_test.reserve(
 p_id uuid, p_auth uuid DEFAULT '10000000-0000-4000-8000-000000000001',
 p_input jsonb DEFAULT NULL, p_type text DEFAULT 'financial'
) RETURNS jsonb LANGUAGE sql AS $$
 SELECT vida_aide.reserve_scan_v1(p_auth,p_id,p_type,coalesce(p_input,(SELECT args->'reserve'->'p_input_data' FROM scan_test.fixture)));
$$;
CREATE FUNCTION scan_test.finish(
 p_id uuid, p_auth uuid DEFAULT '10000000-0000-4000-8000-000000000001',
 p_result jsonb DEFAULT NULL, p_failure text DEFAULT NULL, p_input jsonb DEFAULT NULL,
 p_type text DEFAULT 'financial'
) RETURNS jsonb LANGUAGE sql AS $$
 SELECT vida_aide.finish_scan_v1(p_auth,p_id,p_type,
  coalesce(p_input,(SELECT args->'finish'->'p_input_data' FROM scan_test.fixture)),
  CASE WHEN p_failure IS NULL THEN coalesce(p_result,(SELECT args->'finish'->'p_result' FROM scan_test.fixture)) ELSE NULL END,
  p_failure);
$$;
