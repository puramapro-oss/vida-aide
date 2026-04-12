-- ============================================================================
-- PURAMA AIDE — Schema vida_aide
-- Deploy: docker exec supabase-db psql -U postgres -d postgres -f /tmp/schema.sql
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS vida_aide;
GRANT USAGE ON SCHEMA vida_aide TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA vida_aide TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA vida_aide GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA vida_aide GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA vida_aide GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA vida_aide GRANT ALL ON SEQUENCES TO postgres, service_role, authenticated;

-- ============================================================================
-- USERS / PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  birth_date DATE,
  address JSONB,
  situation JSONB,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'super_admin')),
  subscription_plan TEXT NOT NULL DEFAULT 'free' CHECK (subscription_plan IN ('free', 'premium')),
  subscription_interval TEXT CHECK (subscription_interval IN ('monthly', 'yearly')),
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  wallet_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  purama_points INTEGER NOT NULL DEFAULT 0,
  total_money_recovered NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_demarches_launched INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  streak_days INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'fr',
  theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'auto')),
  onboarded BOOLEAN NOT NULL DEFAULT false,
  tutorial_completed BOOLEAN NOT NULL DEFAULT false,
  iban TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_auth_user_id_idx ON vida_aide.profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS profiles_email_idx ON vida_aide.profiles(email);
CREATE INDEX IF NOT EXISTS profiles_referral_code_idx ON vida_aide.profiles(referral_code);
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx ON vida_aide.profiles(stripe_customer_id);

-- ============================================================================
-- SCANS — résultats de l'IA AideIA
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('financial', 'fiscal', 'forgotten_money', 'juridique')),
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_recoverable NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_recoverable_monthly NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('processing', 'completed', 'failed')),
  ai_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scans_user_id_idx ON vida_aide.scans(user_id);
CREATE INDEX IF NOT EXISTS scans_type_idx ON vida_aide.scans(type);
CREATE INDEX IF NOT EXISTS scans_created_at_idx ON vida_aide.scans(created_at DESC);

-- ============================================================================
-- DEMARCHES — démarches lancées suite à un scan
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.demarches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES vida_aide.scans(id) ON DELETE SET NULL,
  aide_name TEXT NOT NULL,
  category TEXT NOT NULL,
  organisme TEXT NOT NULL,
  montant_estime NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'preparing', 'submitted', 'in_progress', 'accepted', 'rejected', 'completed')),
  lettre_url TEXT,
  reference_dossier TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demarches_user_id_idx ON vida_aide.demarches(user_id);
CREATE INDEX IF NOT EXISTS demarches_scan_id_idx ON vida_aide.demarches(scan_id);
CREATE INDEX IF NOT EXISTS demarches_status_idx ON vida_aide.demarches(status);

-- ============================================================================
-- CONVERSATIONS / MESSAGES — chat AideIA persistant
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON vida_aide.conversations(user_id);
CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON vida_aide.conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS vida_aide.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES vida_aide.conversations(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES vida_aide.scans(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_user_id_idx ON vida_aide.messages(user_id);
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON vida_aide.messages(conversation_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON vida_aide.messages(created_at);

-- ============================================================================
-- MISSIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'collective', 'one_shot')),
  reward_euros NUMERIC(10, 2) NOT NULL DEFAULT 0,
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_contest_places INTEGER NOT NULL DEFAULT 0,
  max_participants INTEGER,
  current_participants INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  difficulty TEXT NOT NULL DEFAULT 'facile' CHECK (difficulty IN ('facile', 'moyen', 'difficile')),
  proof_type TEXT NOT NULL DEFAULT 'auto' CHECK (proof_type IN ('photo', 'screenshot', 'auto', 'none')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS missions_active_idx ON vida_aide.missions(active);
CREATE INDEX IF NOT EXISTS missions_type_idx ON vida_aide.missions(type);

CREATE TABLE IF NOT EXISTS vida_aide.mission_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES vida_aide.missions(id) ON DELETE CASCADE,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected')),
  reward_paid BOOLEAN NOT NULL DEFAULT false,
  reward_paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_completions_user_id_idx ON vida_aide.mission_completions(user_id);
CREATE INDEX IF NOT EXISTS mission_completions_mission_id_idx ON vida_aide.mission_completions(mission_id);

-- ============================================================================
-- CONCOURS / CONTESTS — exactement 10 gagnants
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('weekly', 'monthly', 'yearly', 'special')),
  prizes JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_pool_cents INTEGER NOT NULL DEFAULT 0,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  winners JSONB,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled')),
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contests_status_idx ON vida_aide.contests(status);
CREATE INDEX IF NOT EXISTS contests_end_date_idx ON vida_aide.contests(end_date);

CREATE TABLE IF NOT EXISTS vida_aide.contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  contest_id UUID NOT NULL REFERENCES vida_aide.contests(id) ON DELETE CASCADE,
  places INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, contest_id)
);

CREATE INDEX IF NOT EXISTS contest_entries_user_id_idx ON vida_aide.contest_entries(user_id);
CREATE INDEX IF NOT EXISTS contest_entries_contest_id_idx ON vida_aide.contest_entries(contest_id);

-- ============================================================================
-- REFERRALS / PARRAINAGE
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  referred_id UUID REFERENCES vida_aide.profiles(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'user' CHECK (type IN ('user', 'influencer')),
  promo_percent INTEGER NOT NULL DEFAULT 50,
  promo_expires_at TIMESTAMPTZ,
  commission_first NUMERIC(12, 2) NOT NULL DEFAULT 0,
  commission_recurring NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'active', 'churned')),
  total_earned NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx ON vida_aide.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS referrals_referred_id_idx ON vida_aide.referrals(referred_id);
CREATE INDEX IF NOT EXISTS referrals_code_idx ON vida_aide.referrals(code);

-- ============================================================================
-- WALLET TRANSACTIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mission', 'referral', 'redistribution', 'cashback', 'withdrawal', 'contest_prize', 'bonus', 'refund')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  source_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_transactions_user_id_idx ON vida_aide.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS wallet_transactions_created_at_idx ON vida_aide.wallet_transactions(created_at DESC);

-- ============================================================================
-- WITHDRAWALS — retraits IBAN
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  iban TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS withdrawals_user_id_idx ON vida_aide.withdrawals(user_id);
CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON vida_aide.withdrawals(status);

-- ============================================================================
-- PAYMENTS — paiements Stripe
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  stripe_payment_id TEXT,
  stripe_invoice_id TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  type TEXT NOT NULL CHECK (type IN ('subscription', 'contest_entry', 'one_shot')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_user_id_idx ON vida_aide.payments(user_id);
CREATE INDEX IF NOT EXISTS payments_stripe_payment_id_idx ON vida_aide.payments(stripe_payment_id);

-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS vida_aide.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vida_aide.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  icon TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON vida_aide.notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_read_idx ON vida_aide.notifications(read);

-- ============================================================================
-- TRIGGERS — updated_at + auto-create profile on auth signup + referral_code
-- ============================================================================
CREATE OR REPLACE FUNCTION vida_aide.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profiles_updated_at') THEN
    CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON vida_aide.profiles
      FOR EACH ROW EXECUTE FUNCTION vida_aide.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'demarches_updated_at') THEN
    CREATE TRIGGER demarches_updated_at BEFORE UPDATE ON vida_aide.demarches
      FOR EACH ROW EXECUTE FUNCTION vida_aide.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_updated_at') THEN
    CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON vida_aide.conversations
      FOR EACH ROW EXECUTE FUNCTION vida_aide.set_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION vida_aide.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_referral TEXT;
  v_role TEXT := 'user';
BEGIN
  v_referral := upper(substr(md5(NEW.id::text || extract(epoch from now())::text), 1, 8));
  IF NEW.email = 'matiss.frasne@gmail.com' THEN
    v_role := 'super_admin';
  END IF;
  INSERT INTO vida_aide.profiles (auth_user_id, email, full_name, referral_code, role, subscription_plan)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email),
    v_referral,
    v_role,
    CASE WHEN NEW.email = 'matiss.frasne@gmail.com' THEN 'premium' ELSE 'free' END
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_vida_aide ON auth.users;
CREATE TRIGGER on_auth_user_created_vida_aide
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION vida_aide.handle_new_user();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================
ALTER TABLE vida_aide.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.demarches ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.mission_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.contest_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.notifications ENABLE ROW LEVEL SECURITY;

-- Helper function to check super_admin role without triggering RLS recursion
CREATE OR REPLACE FUNCTION vida_aide.is_super_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM vida_aide.profiles
    WHERE auth_user_id = auth.uid() AND role = 'super_admin'
  );
$$;
REVOKE ALL ON FUNCTION vida_aide.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vida_aide.is_super_admin() TO anon, authenticated;

DO $$ BEGIN
  -- profiles : user voit le sien, super_admin voit tout
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='profiles' AND policyname='profiles_select_own') THEN
    CREATE POLICY profiles_select_own ON vida_aide.profiles FOR SELECT
      USING (auth.uid() = auth_user_id OR vida_aide.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='profiles' AND policyname='profiles_update_own') THEN
    CREATE POLICY profiles_update_own ON vida_aide.profiles FOR UPDATE
      USING (auth.uid() = auth_user_id) WITH CHECK (auth.uid() = auth_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='profiles' AND policyname='profiles_insert_own') THEN
    CREATE POLICY profiles_insert_own ON vida_aide.profiles FOR INSERT
      WITH CHECK (auth.uid() = auth_user_id);
  END IF;

  -- scans : user voit ses scans
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='scans' AND policyname='scans_user_own') THEN
    CREATE POLICY scans_user_own ON vida_aide.scans FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- demarches
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='demarches' AND policyname='demarches_user_own') THEN
    CREATE POLICY demarches_user_own ON vida_aide.demarches FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- conversations / messages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='conversations' AND policyname='conversations_user_own') THEN
    CREATE POLICY conversations_user_own ON vida_aide.conversations FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='messages' AND policyname='messages_user_own') THEN
    CREATE POLICY messages_user_own ON vida_aide.messages FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- missions : public read, write par service_role
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='missions' AND policyname='missions_public_read') THEN
    CREATE POLICY missions_public_read ON vida_aide.missions FOR SELECT USING (true);
  END IF;

  -- mission_completions
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='mission_completions' AND policyname='mission_completions_user_own') THEN
    CREATE POLICY mission_completions_user_own ON vida_aide.mission_completions FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- contests : public read
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='contests' AND policyname='contests_public_read') THEN
    CREATE POLICY contests_public_read ON vida_aide.contests FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='contest_entries' AND policyname='contest_entries_user_own') THEN
    CREATE POLICY contest_entries_user_own ON vida_aide.contest_entries FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- referrals : referrer voit ses referrals
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='referrals' AND policyname='referrals_user_own') THEN
    CREATE POLICY referrals_user_own ON vida_aide.referrals FOR SELECT
      USING (referrer_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- wallet_transactions
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='wallet_transactions' AND policyname='wallet_transactions_user_own') THEN
    CREATE POLICY wallet_transactions_user_own ON vida_aide.wallet_transactions FOR SELECT
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- withdrawals
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='withdrawals' AND policyname='withdrawals_user_own') THEN
    CREATE POLICY withdrawals_user_own ON vida_aide.withdrawals FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- payments
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='payments' AND policyname='payments_user_own') THEN
    CREATE POLICY payments_user_own ON vida_aide.payments FOR SELECT
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;

  -- notifications
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='vida_aide' AND tablename='notifications' AND policyname='notifications_user_own') THEN
    CREATE POLICY notifications_user_own ON vida_aide.notifications FOR ALL
      USING (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()))
      WITH CHECK (user_id IN (SELECT id FROM vida_aide.profiles WHERE auth_user_id = auth.uid()));
  END IF;
END $$;

-- ============================================================================
-- SEED — missions de base + concours actif + super admin enrichi
-- ============================================================================
INSERT INTO vida_aide.missions (title, description, category, type, reward_euros, reward_points, reward_contest_places, difficulty, proof_type) VALUES
  ('Premier scan financier', 'Lance ton premier scan pour découvrir tout l''argent récupérable', 'premier_scan', 'one_shot', 0, 300, 1, 'facile', 'auto'),
  ('Compléter ton profil', 'Remplis ta situation pour des résultats précis', 'completer_profil', 'one_shot', 0, 50, 0, 'facile', 'auto'),
  ('Noter PURAMA Aide', 'Donne 5 étoiles sur les stores', 'note_app', 'one_shot', 0, 200, 3, 'facile', 'screenshot'),
  ('Partager en story', 'Partage l''app sur Instagram/TikTok story', 'story_share', 'daily', 0, 100, 1, 'facile', 'screenshot'),
  ('Inviter un ami', 'Invite un ami avec ton code parrainage', 'parrainage', 'one_shot', 0, 500, 2, 'facile', 'auto'),
  ('Inviter 3 amis', 'Inviter 3 personnes qui s''inscrivent', 'inviter_3_amis', 'one_shot', 0, 800, 5, 'moyen', 'auto'),
  ('Vidéo témoignage', 'Crée une vidéo sur ton expérience PURAMA Aide', 'video_temoignage', 'one_shot', 5, 1000, 10, 'difficile', 'screenshot'),
  ('Lancer une démarche', 'Active ta première demande d''aide', 'lancer_demarche', 'one_shot', 0, 200, 1, 'facile', 'auto'),
  ('Partager un résultat', 'Partage ton montant récupérable', 'partager_resultat', 'weekly', 0, 250, 1, 'facile', 'screenshot'),
  ('Feedback détaillé', 'Donne ton avis sur l''app', 'feedback', 'one_shot', 0, 150, 0, 'facile', 'auto')
ON CONFLICT DO NOTHING;

-- Concours hebdomadaire de démarrage
INSERT INTO vida_aide.contests (title, description, type, prizes, total_pool_cents, start_date, end_date, status)
VALUES (
  'Concours hebdo PURAMA Aide',
  'Tirage tous les dimanches — 10 gagnants, abonnés = x5 places',
  'weekly',
  '[
    {"rank":1,"description":"100€ wallet","value_cents":10000},
    {"rank":2,"description":"50€ wallet","value_cents":5000},
    {"rank":3,"description":"30€ wallet","value_cents":3000},
    {"rank":4,"description":"20€ wallet","value_cents":2000},
    {"rank":5,"description":"15€ wallet","value_cents":1500},
    {"rank":6,"description":"10€ wallet","value_cents":1000},
    {"rank":7,"description":"8€ wallet","value_cents":800},
    {"rank":8,"description":"5€ wallet","value_cents":500},
    {"rank":9,"description":"5€ wallet","value_cents":500},
    {"rank":10,"description":"3€ wallet","value_cents":300}
  ]'::jsonb,
  24600,
  now(),
  now() + interval '7 days',
  'live'
)
ON CONFLICT DO NOTHING;
