# VIDA-ASSOC-BRIEF.md — BRIEF ULTIME CLAUDE CODE

## IDENTITÉ
- **Nom** : VIDA Association
- **Slug** : vida-assoc
- **URL** : vida-assoc.purama.dev
- **Type** : Next.js 14 App Router + Supabase (auth.purama.dev) + Stripe + Vercel
- **Admin** : matiss.frasne@gmail.com (super admin, triple auth)
- **Fondateur** : Tissma (Matiss Dornier), 24 ans, Frasne 25560
- **Association** : PURAMA (loi 1901)
- **IA identité** : L'IA s'appelle "VIDA" — JAMAIS "Claude" ou "IA"

## PROMESSE
> "La plateforme mondiale où chaque don, chaque mission, chaque action positive est récompensée, tracée et multipliée. Toutes les associations du monde unies sous un seul cœur."

## STACK TECHNIQUE
- **Frontend** : Next.js 14 App Router, TypeScript, Tailwind CSS, Framer Motion
- **Backend** : Supabase (auth.purama.dev — self-hosted, projet ylkkmvihffblfhsvabqa)
- **Auth** : Supabase Auth + Google OAuth (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)
- **Paiements** : Stripe (abonnements + dons + commissions) + Apple Pay + PayPal
- **Déploiement** : Vercel (team_dGuJ4PqnSU1uaAHa26kkmKKk)
- **IA** : Claude API (claude-sonnet-4-20250514) pour IA intégrée
- **Emails** : Resend (mail.purama.dev)
- **Multilingue** : next-intl, toutes langues du monde

## ARCHITECTURE SUPABASE (TABLES PRINCIPALES)

```sql
-- Utilisateurs & profils
users (id, email, name, avatar, lang, country, region, city, role, impact_score, consciousness_level, vida_credits, streak_days, is_handicap, handicap_type, created_at)
user_settings (user_id, multisensorial_enabled, notification_mode, accessibility_mode)

-- Associations
associations (id, name, vida_name, logo, description, category, verified, impact_score, missions_count, donations_received, country, website, created_at)
association_members (id, association_id, user_id, role)

-- Missions
missions (id, title, description, type, category, creator_type, creator_id, association_id, reward_type, reward_amount, reward_vida_credits, location_lat, location_lng, location_name, duration_minutes, max_participants, current_participants, difficulty, verification_method, status, proof_required, is_collective, is_sponsored, sponsor_id, created_at, expires_at)
-- type: environment|social|digital|wellness|spiritual|education|food|donation|publicity
-- creator_type: vida|association|enterprise|ong|user
-- verification_method: photo|video|photo_before_after|gps|ai_auto|mutual_confirmation|exif
-- reward_type: money|vida_credits|promo|contest_tickets|mixed

mission_completions (id, mission_id, user_id, proof_photo_url, proof_video_url, proof_gps_lat, proof_gps_lng, proof_exif_data, ai_validation_score, status, validated_at, reward_paid, created_at)

mission_categories (id, name, icon, color, description)
-- Catégories: dépollution, reforestation, aide_personnes_agées, aide_handicapés, aide_sans_abri, anti_gaspillage, jardinage, plantation, nettoyage, courses_solidaires, compagnie_seniors, livraison_repas, soutien_scolaire, traduction, modération, signalement_pollution, collecte_déchets, tri_recyclage, réparation, bricolage, garde_enfants, garde_animaux, massage_bien_être, magnétiseur, coaching, sport, méditation, rituel_collectif, pub_vida, notation_app, parrainage_story, vidéo_promo, dons_personnes, jeûne, marche_nature, cuisine_solidaire, déménagement, aide_administrative, soin_énergétique, lecture_malvoyants, formation, rangement_maison

-- Quêtes quotidiennes
daily_quests (id, user_id, date, missions_required, missions_completed, reward_vida_credits, reward_contest_tickets, completed)

-- Dons
donations (id, donor_id, recipient_type, recipient_id, amount, currency, payment_method, is_recurring, recurring_interval, round_up_enabled, round_up_amount, vida_commission_percent, status, created_at)
-- recipient_type: association|vida|project|user
donation_subscriptions (id, user_id, amount, interval, recipient_type, recipient_id, stripe_sub_id, status)
donation_tiers (id, name, min_amount, rewards_description, contest_tickets, promo_percent)
material_donations (id, donor_id, item_description, item_photo, category, recipient_association_id, status, pickup_location, created_at)

-- Abonnements
subscriptions (id, user_id, plan, price, currency, stripe_sub_id, status, trial_end, started_at, paused_at)
-- plan: monthly|annual
-- Prix: mensuel standard, annuel -30%, premier mois -10%, pause = moitié prix à vie

-- Parrainage
referrals (id, referrer_id, referred_id, referral_code, status, referrer_reward_percent, referrer_lifetime_percent, created_at)
-- referrer gagne 50% premier abonnement + 10% à vie tant que filleul garde abonnement
-- filleul gagne -50% premier mois + places concours + promos
-- parrain cross-app: 5% revenus filleul à vie

-- Influenceurs
influencers (id, user_id, promo_code, promo_link, promo_expiry_days, commission_first_percent, commission_recurring_percent, total_earned, dashboard_enabled, created_at)
-- commission: 50% premier abonnement + 10% récurrent à vie tant qu'abonnement actif
-- promo pour utilisateurs via lien: -50% abonnement
-- lien reste actif après expiration promo mais sans réduction
influencer_sales (id, influencer_id, user_id, subscription_id, commission_amount, paid, created_at)

-- Impact & Suivi
impact_tracker (id, user_id, mission_id, impact_type, impact_value, impact_unit, equivalent_text, created_at)
-- impact_type: co2_saved|waste_collected|water_protected|trees_planted|people_helped|meals_distributed|hours_volunteered
impact_global (id, date, total_co2, total_waste_kg, total_water_l, total_trees, total_people_helped, total_missions, total_users)
user_impact_summary (user_id, total_missions, total_impact_score, total_earned, total_donated, total_contest_tickets, total_promos, streak_current, streak_best, level)
-- Niveaux: Graine → Bâtisseur → Gardien → Source → Lumière

-- Classements
leaderboards (id, period, scope, scope_value, category, user_id, score, rank, created_at)
-- period: daily|weekly|monthly|yearly|alltime
-- scope: global|country|region|department|city
-- Récompenses top 10/100/1000 selon catégorie

-- Jeux concours
contests (id, title, description, type, prizes, start_date, end_date, entry_method, max_entries, created_at)
-- type: weekly|monthly|yearly
-- entry_method: missions|subscription|donations|purchases
contest_entries (id, contest_id, user_id, tickets_used, created_at)
contest_prizes (id, contest_id, rank, prize_description, prize_value, winner_id)

-- Rituels collectifs
rituals (id, title, description, type, frequency, intention, guided_steps, scheduled_at, participants_count, impact_target, created_at)
-- type: pleine_lune|portail_energetique|depollution|paix|amour|pardon|gratitude|abondance|soin_collectif
-- frequency: weekly (change chaque semaine)
ritual_participations (id, ritual_id, user_id, completed, reward_vida_credits, created_at)

-- Produits & Marketplace Vida
products (id, name, description, price, category, image_url, stock, vida_cashback_percent, created_at)
-- catégories: bracelet, soin, formation, purificateur_eau, jardin, livre, téléphone
product_purchases (id, user_id, product_id, amount, cashback_vida_credits, created_at)

-- Formations
formations (id, title, description, type, target_audience, format, content_url, is_free, price, created_at)
-- type: video|livre|papier
-- target_audience: adulte|enfant|handicap_visuel|handicap_auditif|handicap_moteur|tous
formation_progress (id, user_id, formation_id, percent_complete, completed_at)

-- Pub interne utilisateurs
user_ads (id, user_id, title, description, image_url, target_url, budget_vida_credits, impressions, clicks, status, created_at)
-- Seuls les utilisateurs de l'app peuvent promouvoir leurs trucs

-- Notifications
notification_settings (id, user_id, mode, custom_preferences, quiet_hours_start, quiet_hours_end)
-- mode: zen|normal|actif|silencieux
notifications (id, user_id, type, title, body, read, action_url, created_at)
-- type: new_mission|ritual|contest|reward|impact|donation|referral|streak|system

-- Espace social mini
community_posts (id, user_id, content, media_url, type, likes_count, created_at)
community_comments (id, post_id, user_id, content, created_at)
meetups (id, creator_id, title, description, location, date, max_participants, type, created_at)
-- type: pratique_ensemble|rencontre|mission_groupe|rituel

-- Map impact
map_actions (id, user_id, mission_id, lat, lng, action_type, impact_description, photo_url, visible_public, created_at)

-- Fonds redistribution
monthly_fund (id, month, year, total_revenue, redistribution_percent, fund_amount, distributed, created_at)
fund_distributions (id, fund_id, recipient_type, recipient_id, amount, reason, created_at)
-- 50% revenus redistribués aux associations/entreprises/particuliers selon score impact

-- Admin stats (super admin uniquement)
admin_stats (id, date, total_users, total_subscriptions, total_revenue, total_missions_completed, total_donations, total_impact_score)
```

## FONCTIONNALITÉS COMPLÈTES

### 1. SYSTÈME DE MISSIONS (CŒUR)
- **Missions VIDA** : pré-créées par l'admin (100+ missions dans 40+ catégories)
- **Missions Associations/ONG/Entreprises** : publiées par eux, validées par VIDA (uniquement positif/humanitaire)
- **Missions Particuliers** : créées par users (aide jardin 10€, déménagement 20€, courses 15€, etc.)
- **Missions gratuites** : bénévoles récompensées en promos + places concours
- **Missions collectives** : plusieurs personnes, montant choisi par créateur
- **Missions groupées** : proposer mission à plusieurs
- **Quêtes quotidiennes** : chaque jour missions rémunérées automatiques
- **Missions pub VIDA** : payé à noter app, story avec lien parrainage, vidéo promo, photo profil, s'abonner réseaux VIDA
- **Missions lecture** : payé à lire des livres choisis par VIDA (pure/amour/puissance)
- **Missions sport** : payé à marcher, courir, méditer, manger sain
- **Missions jardinage** : payé à faire pousser fruits/légumes chez soi
- **Missions rangement** : photo avant/après validée par IA
- **Missions énergétique** : payé à pratiquer soins énergétiques
- **Missions jeûne** : payé à jeûner
- **Notification nouvelle mission** : push instantané

### 2. VÉRIFICATION MISSIONS (IA + PREUVES)
- Photo avant/après avec métadonnées EXIF (timestamp + geo)
- GPS début + fin pour missions durée (ex: marche 1h)
- Vidéo preuve courte
- Validation IA automatique (ML détection manipulation)
- Double confirmation (aidant + demandeur)
- Score confiance utilisateur
- Capteur croissance plantes (suivi long terme)
- Vérification pub VIDA (IA vérifie stories/posts)
- Audit humain en cas de litige
- Paiement escrow (argent bloqué avant mission, libéré après validation)

### 3. SYSTÈME DE DONS
- Dons ponctuels à VIDA ou toute association
- Dons récurrents (abonnement de dons)
- Système arrondissement personnalisable (chaque dépense)
- Dons matériels (objets pour associations)
- Micro-dons automatiques (0.05€-0.20€/jour)
- Don par émotion (IA adapte cause à l'état)
- Don posthume / héritage humain
- Don éducatif (enfants)
- **Les donateurs sont récompensés** : promos, places concours, réductions produits VIDA
- **Paliers de dons** : plus tu donnes → plus d'accès concours + places + réductions
- Commission VIDA sur dons aux autres associations (5-10%)
- Transparence totale : traçabilité blockchain-like de chaque euro

### 4. ABONNEMENTS
- **Essai gratuit 2 semaines**
- **Sans abonnement** : accès lecture seule (tout voir, rien faire)
- **Mensuel** : prix standard, -10% premier mois
- **Annuel** : -30%
- **Pause** : moitié prix à vie si veut se désabonner
- **VIDA ONE** : 3€/mois abonnement universel du bien (va aux associations)
- 10% CA → association VIDA/PURAMA
- 50% revenus redistribués aux associations/entreprises/particuliers selon score impact
- Abonnés = 5x plus de places concours
- Apple Pay + PayPal + Stripe

### 5. PARRAINAGE
- Parrain : 50% premier abonnement filleul + 10% récurrent à vie
- Filleul : -50% premier mois + places concours + promos
- Cross-app : 5% revenus filleul à vie
- Prime parrainage x2 si filleul prend abonnement vs juste inscription
- Espace dédié parrains (particuliers, entreprises, associations, influenceurs)
- Lien trackable + dashboard gains

### 6. INFLUENCEURS
- Code promo personnalisé (validité 7 jours)
- Lien éphémère -50% abonnement
- Commission : 50% premier abo + 10% récurrent à vie (tant qu'abonné actif)
- Dashboard influenceur dans l'app (ventes, commissions, stats)
- Lien reste actif après expiration promo (sans réduction)
- Paiement automatique dès expiration code
- Admin peut modifier commissions

### 7. IMPACT & SUIVI
- **Compteur personnel** : missions faites, impact mondial, argent gagné, promos, cadeaux
- **Map 3D mondiale** : toutes actions visibles (les siennes + celles des autres)
- **Fil de Vie VIDA** : historique continu jamais effacé, traverse toutes apps VIDA
- **Univers Personnel VIDA** : onglet unique dans chaque app, vision globale
- **Niveaux** : Graine → Bâtisseur → Gardien → Source → Lumière
- **Équivalents réels** : kg déchets, litres eau, arbres, repas, personnes aidées
- **Projection futur** : "si tu continues X années → voici l'impact"
- **Impact collectif temps réel** : compteur mondial
- Streak de bien (jours consécutifs)
- Badges d'impact réel
- Karma score visible

### 8. CLASSEMENTS
- **Scopes** : mondial, pays, région, département, ville
- **Périodes** : jour, semaine, mois, année, all-time
- **Catégories** : meilleurs missionnaires, meilleurs proposeurs de missions, meilleurs donateurs
- **Récompenses** : top 10/100/1000 selon catégorie (promos, produits, argent, places concours)
- Non toxique : célébration collective, pas humiliation

### 9. JEUX CONCOURS
- **Hebdomadaire** : produits VIDA + promos + petits gains
- **Mensuel** : plus gros gains
- **Annuel** : très gros gains
- Pour participer : utiliser l'app = gagner des places
- Abonnés = 5x plus de places
- Missions = plus de places
- Dons = plus de places
- Achats produits = plus de places

### 10. RITUELS COLLECTIFS
- 1x/semaine, thème change chaque semaine
- Thèmes : dépollution, paix mondiale, amour, pardon, gratitude, abondance, soin collectif
- Rituels pleine lune + portails énergétiques
- Connexion simultanée même intention mondiale
- Rituels guidés pré-enregistrés (respiration, intention, soin, méditation)
- **Payés** pour participer
- IA détecte conflits/catastrophes mondiales → crée rituel adapté
- Carte mondiale énergie collective en temps réel

### 11. FORMATIONS
- Vidéo (phone/tablette/PC)
- Format livre/papier (sans téléphone)
- **Audiences** : adultes, enfants, handicapés (tous types)
- Formations VIDA : bracelet, soin, application, purificateur eau, jardin
- Formation spéciale : retrouver pleine puissance
- Gratuites pour personnes dans le besoin
- Suivi progression

### 12. PRODUITS VIDA (MARKETPLACE)
- Bracelets, soins, formations, purificateur eau, jardin, livres, téléphones
- Vente directe dans l'app + lien vers site
- Cashback en points VIDA sur chaque achat
- Promos + places concours à chaque achat
- Bouton accès site web

### 13. PUB INTERNE
- Seuls utilisateurs de l'app peuvent promouvoir leurs trucs
- Pub payante en VIDA credits pour mise en avant
- Pub avant chaque vidéo/livre
- Pubs discrètes intégrées dans l'app
- Pub cross-app (télécharger toutes les apps VIDA sur page d'accueil)
- **Payé à télécharger toutes les apps VIDA**

### 14. ASSOCIATIONS (HUB MONDIAL)
- Annuaire mondial associations vérifiées
- Toutes associations reliées à VIDA
- Option : garder nom + ajouter "VIDA" devant ou logo VIDA
- Micro-app pour chaque association dans VIDA
- Co-branding fusion (identité gardée, infra VIDA)
- Matching IA entre associations (synergies)
- Projets partagés inter-associations
- Chat sécurisé inter-associations
- Score confiance/impact par association
- VIDA toujours en priorité d'affichage
- Les associations gagnent 5-15% revenus générés via plateforme
- Redistribution mensuelle selon score impact
- IA optimisation : rapports subventions auto, gestion bénévoles, communication auto

### 15. ESPACE SOCIAL MINI
- Échanges sur pratiques
- Pratiquer ensemble
- Se rencontrer (meetups)
- S'entraider
- Pas un réseau social complet, juste l'essentiel communautaire

### 16. IA VIDA INTÉGRÉE
- Répond à TOUTES les questions sur l'app
- Propose missions parfaites selon profil/énergie/localisation/temps
- Analyse habitudes, besoins, talents
- Conseils pour maximiser impact et revenus
- Challenges personnalisés
- S'identifie comme "VIDA", jamais "Claude" ou "IA"
- Détecte si missions sont faites (photos, capteurs, pub)
- Valide automatiquement preuves missions
- Matching donateurs ↔ causes
- Répartition optimale des dons selon urgences

### 17. ACCESSIBILITÉ UNIVERSELLE
- Mode handicap visuel (lecteur écran, voix)
- Mode handicap auditif (sous-titres, vibrations, visuel)
- Mode muet (interface gestuelle)
- Mode handicap moteur (navigation simplifiée)
- Grands textes, contrastes forts
- Haptique sur chaque interaction
- Interface adaptée enfants + personnes âgées
- Choix langue (toutes langues du monde)
- Mode multisensoriel désactivable

### 18. MULTISENSORIEL (RÉVOLUTIONNAIRE)
- **Fond écran** : vidéo nature (forêt, rivière, sons apaisants)
- **Effet 3D** : vidéo bouge quand on bouge le téléphone (gyroscope)
- **Swipe panoramique** : swipe haut/bas/gauche/droite = continuité du décor
- **Boutons animés** : couleurs animées, animation + vibration au tap
- **Cinématique lancement** : 5 sec, vibration, décor hypnotique, fréquences pures
- **Vidéo présentation** : première utilisation = vidéo multisensorielle de l'app
- **Mini cinématique** : à chaque démarrage
- **Sons** : fréquences pures, sons nature
- **Vibrations** : haptique sur chaque action
- **Effets visuels** : tout bouge, tout est vivant
- **Désactivable** dans paramètres

### 19. NOTIFICATIONS (RÉVOLUTIONNAIRES)
- Plusieurs modes : zen, normal, actif, silencieux
- Personnalisables par type
- 100% naturelles, jamais énervantes
- Intelligentes (quand ça aide vraiment)
- Nouvelles missions, rituels, concours, récompenses, impact
- Jamais spam

### 20. ADMIN SUPER DASHBOARD
- Accès unique : matiss.frasne@gmail.com (triple auth)
- Stats toutes apps regroupées en un endroit
- Modifier prix, paiements, commissions influenceurs
- Gérer tout : missions, associations, utilisateurs, produits
- Statistiques temps réel : users, abonnements, revenus, missions, dons, impact
- Valider/refuser missions associations
- Gérer jeux concours

### 21. CROSS-APP VIDA
- Toutes apps VIDA reliées (compte unique)
- Pub cross-app sur page d'accueil
- Impact cumulé entre apps
- Univers Personnel VIDA partagé
- Fil de Vie continu entre apps
- Payé à télécharger toutes les apps
- Apps complémentaires reliées (ex: vida-sante ↔ vida-assoc)

### 22. SÉCURITÉ & LÉGAL
- RGPD complet
- Chiffrement données
- Mode "local only" possible
- Permissions minimales
- Export données (PDF, backup)
- Anti-fraude IA
- Escrow paiements missions
- Conforme App Store + Play Store 100%
- Tout légal et approuvé
- Voir exonération impôts pour paiements association/état/ONG

## PAGES & NAVIGATION (4 ONGLETS MAX)

```
🏠 Accueil
├── Cinématique lancement (première fois + chaque démarrage)
├── Feed missions recommandées par IA
├── Quêtes quotidiennes
├── Compteur impact temps réel
├── Pub cross-app VIDA
├── Rituels à venir
├── Concours en cours
└── Bouton action principale (1 tap)

🌍 Missions
├── Carte 3D interactive (missions autour de moi)
├── Liste missions par catégorie
├── Missions VIDA / Associations / Entreprises / Particuliers
├── Créer une mission
├── Mes missions en cours
├── Missions collectives
├── Filtres : type, distance, récompense, durée
└── Notification nouvelles missions

❤️ Impact
├── Mon compteur personnel (missions, gains, promos, cadeaux)
├── Fil de Vie VIDA
├── Map mondiale actions (les miennes + tout le monde)
├── Classements (mondial/pays/région/ville × jour/semaine/mois/an)
├── Projection futur impact
├── Rituels collectifs
├── Espace social / communauté
└── Associations partenaires

👤 Profil
├── Mon Univers VIDA
├── Abonnement & paiements
├── Parrainage (lien + dashboard)
├── Espace influenceur (si applicable)
├── Dons (historique + abonnement dons + arrondissement)
├── Produits VIDA (marketplace + lien site)
├── Formations
├── Concours & récompenses
├── Jeux concours
├── Paramètres (langue, notifications, accessibilité, multisensoriel on/off)
├── IA VIDA (chat questions)
└── [ADMIN] Dashboard stats (si super admin)
```

## DESIGN
- **Thème** : Nature + spirituel + futuriste
- **Couleurs** : Verts profonds, dorés, blancs lumineux, touches bleu cosmos
- **Fond** : Vidéo nature (forêt/rivière) avec effet parallaxe 3D
- **Typo** : Moderne, lisible, douce
- **Animations** : Framer Motion sur chaque interaction
- **Vibrations** : Haptic feedback partout
- **Règle design** : CLAUDE-2.md sections 9/9bis/9ter sont la référence absolue
- **Responsive** : Tous iPhones, iPads, tous Android parfaitement

## MONÉTISATION RÉSUMÉ
| Source | % |
|--------|---|
| Abonnements (mensuel/annuel) | Revenu principal |
| Commission dons autres associations | 5-10% |
| Commission missions particuliers | ~30% |
| Marketplace produits VIDA | Marge produit |
| Pub interne utilisateurs | VIDA credits |
| Abonnement VIDA ONE (3€/mois) | 100% → associations |
| → 10% CA total | → Association PURAMA |
| → 50% revenus | → Redistribués associations/users selon impact |

## PAIEMENT MISSIONS (SOURCES)
1. VIDA paye en promos + accès concours + places + articles VIDA
2. ONG/État/Associations payent en argent réel
3. Entreprises payent missions sponsorisées
4. Particuliers payent leurs propres missions (escrow)

## COMMANDES CLAUDE CODE

```bash
# Setup
mkdir ~/purama/vida-assoc
cd ~/purama/vida-assoc
cp ~/purama/CLAUDE.md .
cp ~/purama/VIDA-ASSOC-BRIEF.md .
touch ~/purama/LEARNINGS.md  # si pas encore créé
claude --dangerously-skip-permissions
# → Coller : "Lis CLAUDE.md et VIDA-ASSOC-BRIEF.md. Construis tout de A à Z."
```

## ENV VARS (CLAUDE CODE CRÉE .env.local AUTO)
```
NEXT_PUBLIC_SUPABASE_URL=https://auth.purama.dev
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from CLAUDE.md>
SUPABASE_SERVICE_ROLE_KEY=<from CLAUDE.md>
STRIPE_SECRET_KEY=<à ajouter>
STRIPE_PUBLISHABLE_KEY=<à ajouter>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<à ajouter>
STRIPE_WEBHOOK_SECRET=<à ajouter>
RESEND_API_KEY=<à ajouter>
ANTHROPIC_API_KEY=<à ajouter>
NEXT_PUBLIC_APP_URL=https://vida-assoc.purama.dev
NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID=<from CLAUDE.md>
```

## RÈGLES ABSOLUES
1. L'IA s'appelle "VIDA" — JAMAIS "Claude"
2. 0 placeholder, 0 TODO, tout connecté, tout fonctionnel
3. Playwright E2E tests obligatoires
4. Design = CLAUDE-2.md sections 9/9bis/9ter
5. Tout automatisé à 100%, admin n'a rien à faire
6. Accessible handicapés/enfants/personnes âgées
7. Multilingue toutes langues
8. Conforme App Store + Play Store
9. RGPD complet
10. Anti-fraude IA sur toutes missions
11. Responsive parfait tous écrans
12. Multisensoriel désactivable
13. 3 taps max pour action principale
14. Performance : rapide même vieux téléphone
15. JAMAIS dire "terminé" si pas 100% testé et fonctionnel
