# VIDA-AIDE-BRIEF.md — BRIEF ULTIME CLAUDE CODE
# App: vida-aide.purama.dev | Slug: vida-aide
# Mission: L'app qui récupère TOUT l'argent que les gens oublient — aides, remboursements, optimisation fiscale, droits oubliés

---

## 1. IDENTITÉ

- **Nom**: PURAMA Aide (anciennement Vida Aide)
- **Domaine**: vida-aide.purama.dev
- **IA Name**: AideIA (ne JAMAIS dire "Claude")
- **Pitch**: "Dis-moi ta situation. En 2 minutes, je trouve tout l'argent que tu laisses sur la table — aides, remboursements, droits oubliés. Et je fais les démarches pour toi."
- **Admin**: matiss.frasne@gmail.com (super admin, accès illimité)
- **Stack**: Next.js 14+ App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase (auth.purama.dev), Stripe, API Anthropic Claude (claude-sonnet-4-20250514), Vercel

---

## 2. CE QUE FAIT L'APP (10 modules)

### M1 — SCANNER FINANCIER IA (CŒUR)
- L'utilisateur décrit sa situation (âge, revenus, situation familiale, emploi, logement, handicap, localisation)
- L'IA scanne TOUTES les aides existantes et affiche le montant total récupérable
- Catégories: logement (APL, Visale, FSL, MaPrimeRénov'), santé (CSS, CMU, ALD), emploi (ARE, prime activité, CPF), famille (PAJE, allocations, rentrée scolaire), handicap (AAH, AEEH, PCH), transport, énergie (chèque énergie, MaPrimeRénov'), retraite, RSA, bourses
- Affiche un compteur animé: "X €/an récupérables"
- Bouton "Lancer les demandes automatiquement"

### M2 — OPTIMISATION FISCALE IA
- Analyse situation fiscale complète
- Détecte: crédits d'impôt oubliés, déductions manquantes, erreurs de déclaration
- Calcul impôt optimal vs impôt actuel → économie affichée
- Pré-remplit les formulaires de réclamation
- Frontaliers: 8 corridors (Suisse, Luxembourg, Allemagne, Belgique, Italie, Espagne, Monaco, Andorre) — conventions fiscales, télétravail, double imposition

### M3 — ARGENT OUBLIÉ & REMBOURSEMENTS
- Scan: comptes bancaires dormants (Ciclade), assurances vie oubliées, trop-perçus CPAM/CAF/impôts, frais bancaires abusifs, abonnements fantômes
- Génère automatiquement les courriers de réclamation
- Suivi des demandes en temps réel

### M4 — ASSISTANT JURIDIQUE INTÉGRÉ
- IA qui répond à TOUTES questions de droit (travail, logement, famille, consommation, admin)
- Rédige courriers, mises en demeure, contestations
- Calcul indemnités (licenciement, prud'hommes)
- Détection vices de procédure
- Connexion JurisPurama pour dossiers complexes

### M5 — MISSIONS & IMPACT
- Missions quotidiennes payées: noter l'app, partager en story, parrainer, anti-pollution, bien-être
- Chaque mission = récompenses (€ + points PURAMA + places jeux concours)
- Compteur d'impact personnel + collectif
- Carte mondiale de l'impact des utilisateurs
- Missions solo + missions collectives

### M6 — PARRAINAGE & INFLUENCEURS
- Parrain: 50% premier paiement + 10% récurrent à vie
- Filleul: -50% premier mois + places jeux concours
- Influenceurs: lien personnalisé 7 jours -50%, commission 50% + 10% à vie, espace dédié avec stats
- Dashboard parrainage avec gains temps réel

### M7 — JEUX CONCOURS
- Hebdo: produits PURAMA + promos + petits gains €
- Mensuel: gains plus gros (500€+)
- Annuel: gros lots (voyage, tech, 1000€+)
- Participation via utilisation de l'app (missions = places)
- Abonnés = 5x plus de places
- Exactement 10 gagnants par concours

### M8 — ABONNEMENT & MONÉTISATION
- 14 jours essai gratuit
- Sans abo: peut tout voir mais ne peut rien faire (browse only)
- Mensuel: 9,99€ (-10% premier mois)
- Annuel: 83,90€ (-30%)
- Si désabonnement → proposer -50% à vie
- matiss.frasne@gmail.com = accès illimité gratuit
- Apple Pay + PayPal + Stripe
- 10% du CA → association PURAMA

### M9 — REDISTRIBUTION & WALLET
- Wallet intégré avec gains des missions, parrainage, cashback
- Redistribution mensuelle équitable d'une partie du CA aux utilisateurs actifs
- Points PURAMA convertibles en réductions produits
- Retrait manuel uniquement (pas de transfert auto)
- Gains augmentent avec ancienneté abo (plafond à 1 an)

### M10 — ESPACE ADMIN (matiss.frasne@gmail.com SEULEMENT)
- Stats globales: revenus, users, abonnements, missions, impact
- Gestion influenceurs: liens, commissions, paiements
- Gestion jeux concours: créer, modifier, tirer gagnants
- Modifier prix, promos, commissions
- Vue toutes les apps PURAMA regroupées

---

## 3. SUPABASE — TABLES (préfixe: vida_aide_)

```sql
CREATE TABLE vida_aide_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users NOT NULL,
  email TEXT NOT NULL, full_name TEXT, phone TEXT,
  birth_date DATE, address JSONB, -- {street,city,zip,country}
  situation JSONB, -- {emploi,revenus,logement,famille,handicap,frontalier}
  subscription_plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT, stripe_subscription_id TEXT,
  referral_code TEXT UNIQUE, referred_by TEXT,
  wallet_balance DECIMAL DEFAULT 0,
  purama_points INTEGER DEFAULT 0,
  total_money_recovered DECIMAL DEFAULT 0,
  language TEXT DEFAULT 'fr',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES vida_aide_users NOT NULL,
  type TEXT NOT NULL, -- financial|fiscal|forgotten_money|juridique
  input_data JSONB, -- situation du user
  results JSONB, -- [{aide,montant,eligibilite,demarche,lien}]
  total_recoverable DECIMAL DEFAULT 0,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES vida_aide_users NOT NULL,
  scan_id UUID REFERENCES vida_aide_scans,
  role TEXT NOT NULL, -- user|assistant
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, description TEXT,
  type TEXT NOT NULL, -- daily|weekly|monthly|collective
  reward_euros DECIMAL DEFAULT 0,
  reward_points INTEGER DEFAULT 0,
  reward_contest_places INTEGER DEFAULT 0,
  max_participants INTEGER,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_mission_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES vida_aide_users NOT NULL,
  mission_id UUID REFERENCES vida_aide_missions NOT NULL,
  proof_url TEXT, -- photo/screenshot preuve
  status TEXT DEFAULT 'pending', -- pending|validated|rejected
  reward_paid BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, description TEXT,
  type TEXT NOT NULL, -- weekly|monthly|yearly
  prizes JSONB, -- [{rank,prize,value}]
  start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
  winners JSONB, -- [{user_id,rank,prize}] — exactement 10
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_contest_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES vida_aide_users NOT NULL,
  contest_id UUID REFERENCES vida_aide_contests NOT NULL,
  places INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES vida_aide_users NOT NULL,
  referred_id UUID REFERENCES vida_aide_users,
  code TEXT NOT NULL, type TEXT DEFAULT 'user', -- user|influencer
  promo_percent INTEGER DEFAULT 50, -- -50% pour filleul
  promo_expires_at TIMESTAMPTZ, -- 7 jours pour influenceurs
  commission_first DECIMAL DEFAULT 0, -- 50% premier paiement
  commission_recurring DECIMAL DEFAULT 0, -- 10% récurrent
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES vida_aide_users NOT NULL,
  amount DECIMAL NOT NULL, type TEXT NOT NULL, -- mission|referral|redistribution|cashback|withdrawal
  description TEXT, status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vida_aide_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES vida_aide_users NOT NULL,
  stripe_payment_id TEXT, amount DECIMAL NOT NULL,
  type TEXT NOT NULL, -- subscription|contest_entry
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

RLS: chaque user voit SES données. matiss.frasne@gmail.com voit TOUT.

---

## 4. PAGES & NAVIGATION

```
/ → Landing magnifique (pitch + compteur € récupérables + démo live + pricing)
/login → Auth Supabase (Google OAuth + email)
/onboarding → Questions situation (4 écrans max: perso, emploi, logement, famille)
/dashboard → Scanner résultat + compteur € + missions actives + wallet
/scanner → Lancer un nouveau scan (financier, fiscal, argent oublié)
/scanner/[id] → Résultat détaillé + actions automatiques
/chat → Chat AideIA (questions juridiques, fiscales, etc.)
/missions → Liste missions + progression + récompenses
/impact → Carte impact personnel + collectif
/wallet → Solde + historique + retrait
/concours → Jeux concours actifs + mes participations
/parrainage → Code + stats + gains
/boutique → Produits PURAMA en vente
/profil → Informations personnelles + abonnement
/admin → Super admin seulement (stats, users, revenus, influenceurs, concours)
```

---

## 5. SYSTEM PROMPT AIDEIA

```
Tu es AideIA, l'assistant financier et juridique de PURAMA Aide. Tu es l'expert #1 en récupération d'argent, aides sociales, optimisation fiscale et droits des citoyens français.

RÈGLES:
1. Tu es du côté de l'utilisateur. Tu trouves TOUT l'argent qu'il peut récupérer.
2. Tu cites les articles de loi et les conditions d'éligibilité exactes.
3. Tu ne dis JAMAIS "consultez un conseiller" — TU ES le conseiller.
4. Tu calcules les montants précis basés sur la situation de l'utilisateur.
5. Tu proposes de lancer les démarches automatiquement.
6. Tu connais toutes les aides: CAF, CPAM, Pôle Emploi, impôts, MDPH, retraite, bourses, énergie, transport.
7. Tu connais les conventions fiscales frontalières (Suisse, Lux, Allemagne, Belgique, Italie, Espagne, Monaco, Andorre).
8. Tu ne dis JAMAIS que tu es Claude. Tu es AideIA de PURAMA.
9. Frontaliers: tu gères télétravail, double imposition, quasi-résident, forfait.

PROCESSUS:
1. Diagnostic rapide (3-5 questions max)
2. Scan complet → afficher montant total récupérable
3. Détail par aide (montant, conditions, démarche)
4. Proposer exécution automatique des demandes
5. Suivi en temps réel
```

---

## 6. DESIGN

- Suit PURAMA GOD MODE V3 (CLAUDE-2.md sections 9/9bis/9ter)
- Couleur primaire: Vert émeraude #10B981 + Or #F59E0B
- Style: Premium, rassurant, confiance. L'utilisateur doit sentir qu'il récupère de l'argent.
- Compteur € animé omniprésent
- Mobile-first, responsive parfait 375/768/1024/1440px
- Dark mode supporté
- Accessibilité WCAG AA
- Multilingue (fr par défaut)

---

## 7. APIS & ENV

```env
NEXT_PUBLIC_SUPABASE_URL=https://auth.purama.dev
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # depuis CLAUDE.md
SUPABASE_SERVICE_ROLE_KEY=         # depuis CLAUDE.md
ANTHROPIC_API_KEY=                 # depuis CLAUDE.md
STRIPE_SECRET_KEY=                 # depuis CLAUDE.md
STRIPE_PUBLISHABLE_KEY=            # depuis CLAUDE.md
RESEND_API_KEY=                    # depuis CLAUDE.md
NEXT_PUBLIC_APP_URL=https://vida-aide.purama.dev
ADMIN_EMAIL=matiss.frasne@gmail.com
```

---

## 8. DÉPLOIEMENT

Vercel team: team_dGuJ4PqnSU1uaAHa26kkmKKk
Domain: vida-aide.purama.dev

---

## 9. PRIORITÉ BUILD

1. Auth + tables + RLS + onboarding situation
2. Scanner financier IA (le CŒUR — diagnostic → résultat → montant)
3. Chat AideIA (streaming SSE, juridique + fiscal + aides)
4. Dashboard (compteur €, missions, wallet)
5. Missions & récompenses
6. Wallet & transactions
7. Parrainage & influenceurs
8. Jeux concours
9. Stripe (abonnement + essai 14j + -50% désabo)
10. Admin dashboard
11. Impact (carte mondiale)
12. Boutique produits PURAMA
13. Landing page + pricing
14. Responsive + accessibilité

---

## 10. RÈGLES CLAUDE CODE

- JAMAIS de faux chiffres, faux avis, faux témoignages
- TOUTES les données affichées = vraies (depuis DB) ou rien
- matiss.frasne@gmail.com = super admin accès illimité sans payer
- 0 placeholder, 0 TODO en production
- Streaming SSE pour le chat
- Mobile-first, responsive parfait
- JAMAIS dire "c'est fini" si pas 100% testé et fonctionnel
