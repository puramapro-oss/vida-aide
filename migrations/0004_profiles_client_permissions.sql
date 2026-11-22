-- Profile money, privileges and technical fields are owned by server routes.
-- The only direct client UPDATE is OnboardingFlow's two personal progress flags.
-- Other personal edits already use the validated /api/profile/update route.
-- Existing rows, SELECT policies, signup trigger and service_role grants remain.
BEGIN;

-- Table-level REVOKE also removes the corresponding column grants. Revoking
-- only individual columns would leave the historical table UPDATE grant active.
-- Include PUBLIC so an inherited public grant cannot reopen the client boundary.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE vida_aide.profiles FROM PUBLIC, anon, authenticated;

GRANT UPDATE (onboarded, tutorial_completed)
  ON TABLE vida_aide.profiles TO authenticated;

-- Profiles are created by the existing auth.users SECURITY DEFINER trigger.
-- No current browser/native caller inserts or upserts a profile directly.
DROP POLICY IF EXISTS profiles_insert_own ON vida_aide.profiles;

-- Fail closed if an unexpected inherited role still grants protected writes.
DO $$
DECLARE
  column_name text;
BEGIN
  IF has_table_privilege('authenticated', 'vida_aide.profiles',
       'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('anon', 'vida_aide.profiles',
       'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Unexpected inherited client profile privileges';
  END IF;

  FOR column_name IN
    SELECT attname FROM pg_catalog.pg_attribute
    WHERE attrelid = 'vida_aide.profiles'::regclass
      AND attnum > 0 AND NOT attisdropped
  LOOP
    IF has_column_privilege('authenticated', 'vida_aide.profiles', column_name, 'UPDATE')
         IS DISTINCT FROM (column_name IN ('onboarded', 'tutorial_completed'))
       OR has_column_privilege('authenticated', 'vida_aide.profiles', column_name, 'INSERT,REFERENCES')
       OR has_column_privilege('anon', 'vida_aide.profiles', column_name, 'INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Unexpected client profile column privileges';
    END IF;
  END LOOP;
END;
$$;

COMMIT;
