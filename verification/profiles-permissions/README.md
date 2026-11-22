# Permissions d’écriture des profils — réception du 22 novembre 2026

## Contrat conservé

L’inventaire des 241 fichiers de la base `af8eda90be63dba1592f347a9356b85fc0144b55` trouve une seule écriture directe d’un profil depuis un client : `src/components/shared/OnboardingFlow.tsx` écrit `onboarded` et `tutorial_completed`. Aucun client ne crée ou ne remplace directement un profil. Les formulaires de profil et paramètres passent par `POST /api/profile/update`, dont l’allowlist personnelle et l’utilisation du client serveur sont conservées.

La migration additive `0004_profiles_client_permissions.sql` retire les droits de mutation de table accordés à `PUBLIC`, `anon` et `authenticated`, puis rétablit uniquement l’édition des deux drapeaux du tutoriel pour `authenticated`. Les droits d’écriture par colonne hérités du grant de table sont retirés également. Le contrôle final refuse la migration si une autre appartenance de rôle conserve un droit d’écriture protégé.

| Opération | Résultat attendu |
| --- | --- |
| Lecture de son profil | Politique existante conservée |
| Lecture administrative autorisée | Politique existante conservée |
| Modification de ses deux drapeaux du tutoriel | Autorisée sous RLS |
| Modification du profil d’un autre compte | Refusée par RLS |
| Écriture directe de rôle, abonnement, portefeuille, points, historique ou autre colonne | Refusée |
| INSERT ou UPSERT direct d’un profil | Refusé, même pour son propre identifiant |
| Création normale après insertion dans `auth.users` | Trigger existant conservé |
| Éditions personnelles et financières via `service_role` | Privilèges existants conservés |
| Anciennes valeurs et historique | Aucune modification ni remise à zéro |

Le schéma historique n’est pas réécrit. La migration n’ajoute aucune route, identité de service, transaction financière ou connexion distante.

## Recette PostgreSQL réelle

Le lanceur crée son propre cluster jetable à partir d’un répertoire de binaires PostgreSQL existant. Il exécute le vrai `schema.sql`, la migration et les cas SQL, puis supprime son cluster. Il n’utilise aucun socket ni URL de connexion et ne lit aucune configuration de production.

```sh
python verification/profiles-permissions/run-postgres.py \
  --pg-bin-dir /chemin/vers/postgresql/bin \
  --evidence-dir /chemin/vers/preuves-jetables
```

Chaque invocation conserve des journaux et un reçu dans un nouveau sous-dossier. La calibration utilise seulement des tables temporaires ordinaires jusqu’aux OID utilisateurs ; aucune modification de catalogue ou de binaire. La recette impose ensuite `row_security_active(...) = true` sous le rôle `authenticated`, distinct du propriétaire et sans contournement RLS.

**PASS local, PostgreSQL 18.7 :** les mêmes contrôles reproduisent d’abord l’acceptation de l’UPDATE privilégié et de l’INSERT forgé sur le schéma initial, puis passent après migration. Onze cas comportementaux couvrent les colonnes protégées, les patchs mixtes, le tutoriel propriétaire/tiers, l’accès anonyme, les grants effectifs, le serveur, le trigger de création, les données historiques, la lecture administrative et une future colonne technique. La réapplication conserve les données et permissions. Un droit hérité inattendu fait échouer la migration au lieu de produire un faux succès.

Ces essais utilisent une session locale à la fois. Ils ne démontrent aucune propriété de concurrence et ne qualifient pas une base distante. Le compte serveur, les utilisateurs, les valeurs et les métadonnées d’attaque sont synthétiques.

## Contrat HTTP du profil

```sh
VIDA_AIDE_VERIFICATION_NODE_MODULES=/chemin/vers/banc/node_modules \
  node --test verification/profiles-permissions/profile-update.test.cjs
```

**PASS local : 24 tests.** Ils chargent la vraie route `POST /api/profile/update`, avec le vrai validateur Zod et `NextResponse`. Seules les frontières d’identité et de stockage sont simulées. Vingt et un champs protégés sont rejetés avant toute acquisition du client serveur ; l’édition personnelle autorisée conserve son filtre propriétaire et un corps vide ne provoque aucune mutation. Une erreur d’authentification accompagnée d’un objet utilisateur résiduel est maintenant refusée avant l’acquisition du client serveur : le même cas répondait 200 et échouait avant la correction minimale, puis répond 401 sans écriture. Cette recette ne certifie pas l’authentification distante ni les autres routes de profil.

## Limites de réception

La CI hébergée et l’application de la migration sur une cible sont à recevoir séparément. Aucun déploiement, fournisseur, paiement ni migration distante n’a été exécuté. Le correctif ne réconcilie pas les anciennes estimations stockées dans `total_money_recovered` et ne transforme pas cet historique en preuve de fonds reçus. Les contrôles des routes Stripe et du scanner possèdent leurs propres lots et reçus.

Références de syntaxe et de portée : [REVOKE PostgreSQL 18](https://www.postgresql.org/docs/18/sql-revoke.html), [GRANT](https://www.postgresql.org/docs/18/sql-grant.html), [RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
