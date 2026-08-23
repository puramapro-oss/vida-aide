# CONFORMITÉ NIYAMA — vida-aide (PURAMA Aide)

Audit indépendant du rollout socle légal exécuté le 2026-08-23. Méthode : lecture directe du code
(pas déclaratif), grep d'usage réel (import ≠ rendu), vérification indépendante de la base de
production via SSH + `docker exec supabase-db psql`. Référence : `NIYAMA-BRIEF.md` §7.

Famille NIYAMA réelle (déduite du code, non déclarée formellement) : **1 — KARMA/wellness**
(l'app paie ses utilisateurs : wallet, missions rémunérées, parrainage, concours).

---

## 1. Pages légales — PRÉSENT mais PAS le socle générateur

- `/mentions-legales`, `/cgu`, `/cgv`, `/politique-confidentialite`, `/cookies` existent, contenu
  réel et cohérent (SASU PURAMA, 8 Rue de la Chapelle 25560 Frasne, art. 293 B CGI, SIRET honnête
  "en cours d'enregistrement" — pas d'invention).
- **MAIS** ces 5 pages sont l'ANCIEN contenu codé en dur (`src/app/{mentions-legales,cgu,cgv,
  politique-confidentialite,cookies}/page.tsx`, daté "6 avril 2026"), **PAS** le socle NIYAMA.
  Les générateurs du socle (`buildMentionsLegales`, `buildCGU`, `buildCGV`,
  `buildPolitiqueConfidentialite`, composant `LegalPage`) existent bien dans
  `src/lib/legal/content/*.ts` et `src/lib/legal/components/LegalPage.tsx`, exportés dans
  `src/lib/legal/index.ts`, mais **zéro appel réel** :
  `grep -rn "buildCGU|buildCGV|buildMentionsLegales|buildPolitiqueConfidentialite|LegalPage\b" src/app` → 0 résultat.
- Conséquence : le rollout affirmant "mentions légales/CGV corrigées" a corrigé les pages
  EXISTANTES à la main (légitime — cf `packages/legal/README.md` : ne pas remplacer un existant
  qui marche), mais a copié ~9 fichiers de générateur inertes dans le repo sans jamais les brancher.
  Code mort, pas un défaut légal en soi, mais à nettoyer ou à brancher.
- CGV présente (aPaiement=true, Stripe checkout réel) — cohérent.

## 2. Bandeau cookies — FONCTIONNEL mais système dupliqué

- `src/app/layout.tsx:102` monte `CookieBanner` (`src/components/shared/CookieBanner.tsx`),
  l'ancien bandeau déjà existant — décision correcte per `packages/legal/README.md` ("Ne PAS
  remplacer un bandeau cookies déjà fonctionnel").
- Fonctionnel : accept/decline, `localStorage['vida_cookie_consent']`, ré-affiché tant que non
  répondu. La page `/cookies` documente fidèlement CETTE clé (pas celle du socle) — cohérent.
- **Persistance = localStorage SEUL, aucune sync DB.** La table `cookie_consents` existe en prod
  (vérifié §8) et la route `POST /api/legal/cookie-consent` existe (`src/app/api/legal/
  cookie-consent/route.ts`), mais **rien dans le code ne l'appelle jamais** :
  `grep -rn "cookie-consent" src` ne retourne que la définition de la route + un commentaire de
  doc dans le hook. Le nouveau `CookieConsentBanner`/`useCookieConsent` (3 catégories
  nécessaire/mesure/marketing + sync serveur) sont eux aussi 100% morts — importés nulle part.
- Verdict : le consentement cookies est réellement fonctionnel pour un usage basique
  (accept/decline mémorisé), mais **ne survit pas à un changement de navigateur/reset de
  localStorage**, et la preuve de consentement n'est jamais indépendante du client — contrairement
  à ce que permettrait l'infrastructure déjà déployée (table + route + hook), simplement non
  reliée. Gap mineur, pas bloquant (la loi n'exige pas de sync DB pour un consentement cookies
  basique), mais l'incohérence politique-confidentialite / cookies affirmant "cookies exclusivement
  essentiels, aucun tracking" alors qu'un bandeau accept/decline existe est une contradiction de
  contenu (pourquoi demander un consentement pour du "strictement nécessaire" ?) — à corriger
  dans le texte ou à assumer un vrai cookie non-essentiel.

## 3. Preuve d'acceptation CGU horodatée — CASSÉE POUR MOITIÉ DES INSCRIPTIONS

- Signup email/mot de passe (`src/app/(auth)/signup/page.tsx:75`) : `acceptLegalDocs()` est bien
  appelée après `signUp()` réussi, et boucle sur `cgu`/`cgv`/`confidentialite` via
  `POST /api/legal/accept`. **Fonctionne.**
- **Signup/connexion Google OAuth : `/api/legal/accept` n'est JAMAIS appelée.**
  - `handleGoogleSignup()` (signup/page.tsx:56-63) appelle seulement `signInWithGoogle()` puis
    redirige — aucun `acceptLegalDocs()`.
  - `signInWithGoogle()` (`src/hooks/useAuth.ts:78-84`) redirige vers `/auth/callback`.
  - `src/app/auth/callback/route.ts` échange le code puis redirige directement vers `/dashboard`
    — aucun appel à `/api/legal/accept`.
  - Le trigger DB `vida_aide.handle_new_user()` (schema.sql L330-352) crée uniquement la ligne
    `profiles`, rien dans `legal_acceptances`.
  - Le bouton Google est affiché en PREMIER sur `/signup` (avant le formulaire email), donc c'est
    potentiellement le chemin d'inscription majoritaire.
- Conséquence : tout utilisateur qui s'inscrit (ou se reconnecte pour la première fois) via Google
  n'a **aucune preuve d'acceptation CGU/CGV/confidentialité horodatée en base**, alors que
  NIYAMA-BRIEF §1 l'exige explicitement ("preuve d'acceptation horodatée — qui, quelle version,
  quand"). C'est le point que le rollout n'a manifestement pas testé en vrai (seul le flux email a
  été vérifié).
- Vérifié en prod : `SELECT count(*) FROM vida_aide.legal_acceptances` → **0 ligne** (déploiement
  très récent, aucun signup réel encore passé — donc le bug n'a pas encore de victime, mais il est
  actif et non corrigé).

## 4. "Ma mémoire" / export RGPD / suppression de compte — CORRECT

- `profiles.id ≠ auth.users.id` est réellement le cas ici (`profiles.auth_user_id UUID UNIQUE NOT
  NULL REFERENCES auth.users(id)`, schema.sql L19) — CONFIRMÉ, pas une fausse alerte.
- `GET /api/legal/my-data` (`src/app/api/legal/my-data/route.ts`) gère correctement les DEUX
  conventions : résout d'abord `profile.id` via `auth_user_id`, interroge `legal_acceptances`/
  `cookie_consents` sur `user_id = auth.users.id` (FK correcte, vérifiée en prod) et les 10 tables
  métier (`scans`, `demarches`, `conversations`, `messages`, `mission_completions`,
  `contest_entries`, `wallet_transactions`, `withdrawals`, `payments`, `notifications`,
  `referrals`) sur `profile.id`. Commentaire en tête du fichier documente explicitement
  l'adaptation. Export réel, pas un faux JSON vide.
- Suppression de compte : `POST/DELETE /api/account/delete`, grâce 30 jours, mot de confirmation
  `DELETE_MY_ACCOUNT`, table `account_deletion_requests` (vérifiée en prod, RLS activée).
  `AccountDeletionButton` monté dans `MaMemoirePage`, elle-même montée sur
  `/dashboard/ma-memoire`, lien accessible depuis `dashboard/settings/page.tsx:61`. Chaîne complète
  et fonctionnelle.

## 5. Déclaration IA sur chaque UI de chat — OK, les 2 interfaces

- `src/app/(dashboard)/chat/page.tsx:99` : `<AIDisclosure appName={APP_NAME} extra="...ne
  remplace pas l'avis d'un professionnel qualifié." />` — rendu réel.
- `src/app/aide/AideClient.tsx:153` : `<AIDisclosure appName={APP_NAME}
  className="text-xs text-[var(--text-muted)]" />` dans l'en-tête du panneau de chat flottant
  AideIA — rendu réel (vérifié par lecture directe, pas juste grep — l'import seul aurait pu
  induire en erreur un grep de surface).

## 6. Lexique interdit / avis rémunérés / promesses / faux témoignages — ROUGE, violation confirmée

- **Aucune occurrence de lexique promotionnel interdit** dans les pages légales/marketing
  (grep "garanti", "100% sûr", "à coup sûr", "leader" etc. → seulement des clauses de non-garantie
  correctes dans CGU/mentions).
- **MAIS mécanique active de récompense pour avis/notes rémunérés — violation directe de
  NIYAMA-BRIEF §2 Famille 1 ("JAMAIS d'avis/notes/installs rémunérés")**, 7ème app touchée après
  akasha-ai/sarva/mukti/purama-origin/yana/sutra :
  - `schema.sql:491` — mission seedée en prod : `('Noter PURAMA Aide', 'Donne 5 étoiles sur les
    stores', 'note_app', 'one_shot', 0, 200, 3, 'facile', 'screenshot')` → **200 points + 3 tickets
    concours contre une note 5 étoiles sur les stores**. Interdit par les CGU App Store/Play Store
    (avis incités) ET par NIYAMA §2.1.
  - `schema.sql:495` — `('Vidéo témoignage', 'Crée une vidéo sur ton expérience PURAMA Aide',
    'video_temoignage', 'one_shot', 5, 1000, 10, 'difficile', 'screenshot')` → **5€ cash réel +
    1000 points + 10 tickets concours** contre une vidéo témoignage, dont la description dans
    `src/lib/constants.ts:118` précise explicitement "Témoignage vidéo **sur les gains
    récupérés**" — témoignage rémunéré et biaisé par construction (sélection des gagnants), motif
    identique au piège déjà documenté sur vida-langue.
  - `src/lib/constants.ts:117` — mission `feedback` ("Donne ton avis constructif", 150 pts) est du
    feedback produit interne, pas un avis public — pas un problème en soi, mais le mot "avis" est
    trompeur dans un contexte où deux autres missions paient explicitement des avis publics.
  - Aggravant : `POST /api/missions/complete` (`src/app/api/missions/complete/route.ts`) **ne
    vérifie aucune preuve** avant de payer — `mission_completions.proof_url`/`proof_type` existent
    en colonne mais ne sont ni exigés ni contrôlés côté serveur. L'utilisateur clique "Valider" et
    reçoit immédiatement les 200 pts / 5€ + 1000 pts, sans avoir à prouver qu'il a réellement noté
    l'app ou publié la vidéo. C'est donc une incitation à noter 5 étoiles pour de l'argent, sans
    même de vérification.
- Recommandation : retirer `note_app` et `video_temoignage` (ou les reformuler sans lien avec la
  note/l'avis — ex. remplacer par une mission de partage neutre) et couper leur `active=true` en
  base dès que possible.

## 7. Chiffres vs FACTS.md — cohérents pour les points vérifiables

- `WALLET_MIN_WITHDRAWAL = 5` (`src/lib/constants.ts:64`) = FACTS.md (5€). ✅
- Parrainage : `referrer_first_percent: 50`, `referrer_lifetime_percent: 10` (constants.ts:153-154)
  et webhook `stripe-fulfillment/route.ts:71` ("50% premier paiement") — cohérent avec la
  Résolution #2 (N1=50% premier paiement + à vie). ✅
- Split KARMA 50/10/40 : `ASSO_PERCENTAGE = 10`, `REDISTRIBUTION_PERCENTAGE = 50`
  (constants.ts:65-66) laissent supposer 40% SASU par complément, mais **aucune fonction
  `splitRevenue`/`karma.ts` n'a été trouvée dans le code** — le split n'est nulle part appliqué
  mécaniquement dans les routes de paiement lues. Ni faux ni confirmé — non câblé/non vérifiable
  dans le périmètre de cet audit, à vérifier séparément (hors scope strict NIYAMA).

## 8. Migration SQL — VÉRIFIÉE INDÉPENDAMMENT EN PROD, mais absente du repo app

- Vérification directe (pas confiance sur affirmation) : SSH VPS → `docker exec supabase-db psql
  -U postgres -d postgres`, requêtes sur `information_schema.tables` et `pg_policies` :
  - `vida_aide.legal_acceptances`, `vida_aide.cookie_consents`,
    `vida_aide.account_deletion_requests` existent bien, RLS activé (`relrowsecurity = t`) sur les
    3, policies `select_own`/`insert_own`/`update_own` présentes et correctes (`auth.uid() =
    user_id`), FK `user_id → auth.users(id) ON DELETE CASCADE` correcte sur `legal_acceptances`.
  - **CONFIRME l'affirmation du rollout ("migration exécutée et vérifiée en prod").**
- **MAIS** : aucun fichier de migration correspondant n'existe dans
  `vida-aide/migrations/` (contient seulement `0002_story_shares.sql`, `0003_financement_pools.sql`,
  `0003_fix_profiles_rls_recursion.sql`). Le SQL réellement exécuté est
  `packages/legal/sql/001_legal_core.sql` (templaté `__SCHEMA__` → `vida_aide`), appliqué en
  direct par SSH sans être commité dans le dossier `migrations/` de l'app. Risque de
  reproductibilité : reconstruire la base depuis `migrations/` seul ne recréerait pas ces 3
  tables. À corriger en ajoutant `migrations/0004_legal_core.sql` (copie templatée) au repo.

## 9. `LegalReacceptanceGate` — NON MONTÉ (gap confirmé, conforme au constat écosystème)

- `grep -rn "LegalReacceptanceGate" src` ne retourne que la définition du composant, son export,
  et 2 commentaires de doc — **jamais un `<LegalReacceptanceGate .../>` dans un layout ou une
  page.** Confirme le gap "quasi-universel" (vridha seule app à l'avoir monté).
- Impact actuel limité : `CURRENT_LEGAL_VERSIONS` sont toutes fraîchement à `'1.0'`
  (`src/lib/legal/versions.ts:16-21`, historique daté 2026-08-23), donc personne n'a encore de
  version antérieure à re-accepter. Mais le mécanisme n'existe pas dans l'UI : le jour où une
  version de CGU change, **aucun utilisateur existant ne sera jamais bloqué ni notifié** — la
  ré-acceptation restera un système mort tant que le gate n'est pas branché quelque part
  (`(dashboard)/layout.tsx` est l'endroit naturel).

---

## Verdict par point du checklist NIYAMA §7

| Point | Statut |
|---|---|
| Famille déclarée = code réel | ❌ Jamais déclarée formellement (aucun `LegalAppConfig` instancié) |
| Socle complet, liens légaux testés, consent fonctionnel | ⚠️ Pages présentes et correctes (ancien contenu, pas le générateur) ; consentement cookies fonctionnel mais non synchronisé, infra dupliquée morte |
| Lexique interdit : 0 occurrence | ❌ 0 occurrence lexicale, mais 2 missions actives = avis/notes + témoignage rémunérés, sans vérification serveur |
| Pièges spécifiques de l'app vérifiés | ❌ Piège Famille 1 (avis rémunérés) non respecté |
| Fiches stores privacy générées | ❌ Aucune trouvée (`find . -iname "*privacy*"` / "*data-safety*" → 0 résultat) |
| Preuves d'acceptation CGU actives | ❌ Cassées pour tout signup Google OAuth |
| Registres/exports à jour | ✅ Export RGPD réel et correct, suppression de compte fonctionnelle |

**8 gaps identifiés** (dont 2 sévères : missions avis/témoignages rémunérés actives en prod §6,
acceptation CGU cassée pour OAuth §3) sur les 7 points de la checklist NIYAMA §7 plus les 2 items
d'infrastructure (§8 migration non tracée dans le repo, §9 gate non monté).

VERDICT:vida-aide:ROUGE:8
