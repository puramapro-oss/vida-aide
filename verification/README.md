# Vérification du parcours estimations, quotas et reçus

Ce dossier teste les sources de VIDA Aide sans configuration de production. Son verrou npm est isolé des dépendances privées du monorepo. Il ne remplace pas la qualification complète de l’application ou du client Expo.

## Parcours vérifiés

| Lot | Contrat et preuve |
| --- | --- |
| Scans | [Réservation, reçu, périodes et conservation de l’historique](scan-quota/README.md) |
| Clients web et natif | [Reçu des composants réels, identité et reprise de la demande](scan/client-receipt.json) |
| Profil | [Privilèges clients et route d’édition personnelle](profiles-permissions/README.md) |
| Stripe | [Règlement atomique, signature, crédits et rapprochement historique](stripe-fulfillment/README.md) |
| Concours hebdomadaires | [Règlement des prix, clôture, droits et conservation de l’historique](contest-payout/README.md) |

Le checkpoint WIP précède la qualification commune. Les reçus détaillés et le contrôle des empreintes indiquent les sources effectivement exécutées pour chaque lot.

## Exécution isolée

```sh
npm ci --prefix verification --ignore-scripts --no-audit --no-fund
export VIDA_AIDE_VERIFICATION_NODE_MODULES="$PWD/verification/node_modules"
export VIDA_PRESENTATION_TOOLS="$PWD/verification"
node --test --test-concurrency=1 \
  verification/scan/*.test.cjs \
  verification/profiles-permissions/*.test.cjs \
  verification/stripe-fulfillment/*.test.cjs \
  verification/contest-payout/*.test.cjs
```

Les recettes PostgreSQL et la CI sont décrites dans chaque lot. Les recettes mono-utilisateur n’écoutent aucun socket. Les gates de concurrence créent uniquement un serveur jetable à socket UNIX privé, sans écoute TCP ni lecture d’une URL de production ; ils suppriment leur cluster après arrêt vérifié. Ne pas leur substituer une base existante.

Le workflow `receipts-and-estimates.yml` extrait le SHA exact de la tête de PR. Il enregistre toutes les empreintes avant les tests, les compare après les contrôles et publie les journaux avec le reçu. Il n’effectue aucun déploiement. La branche de travail possède également une garde Vercel désactivant le déploiement automatique.

Le shell est explicitement `bash` : GitHub utilise alors `-eo pipefail`, ce qui propage l’échec d’un test placé avant `tee`. La contre-épreuve `false | tee /dev/null` renvoie 0 avec le seul `bash -e` et 1 avec le shell explicite configuré. Ce contrôle évite de qualifier un journal correctement enregistré dont la commande de test aurait échoué.

Le banc backend local possède les versions exactes vérifiées dans `evidence/backend-runtime-assembly.json`. Les composants utilisent React réel et des adaptateurs limités aux frontières navigateur/natives ; leur reçu précise les limites de dépendances et de matériel. Les tests SDK utilisent un transport synthétique et aucune clé réelle.

## Statuts à conserver

Le contrôle local combiné historique est **PASS, 269 tests** : 87 scan, 2 SDK, 55 clients/prompt, 24 profil, 44 Stripe, 7 gardes cron et 50 concours. Les empreintes des sources produit, tests et SQL sont restées identiques pendant cette exécution ; son reçu et son journal sont versionnés et conservés. Le complément de validation des reçus de rejeu ajoute deux contre-tests concours : la suite courante a été réexécutée **PASS, 271 tests, aucun saut**, avec le typage backend ciblé sans diagnostic. Les recettes PostgreSQL mono-utilisateur comportent 11 cas profil, 16 Stripe, 16 scan et 19 concours, avec leurs reçus distincts. Les résultats des trois gates multi-session (Stripe, scan, concours) doivent être rapprochés du SHA exact et des artefacts du workflow, sans transférer automatiquement une réussite à une révision ultérieure.

La première tentative GitNexus avait été interrompue avec le code 137. Une indexation séparée de la base `ebf7c3fc` a ensuite réussi ; elle retrouve l'appel direct GET → POST du cron. Des frontières entre langages et des chemins non explorés sont signalés par l'outil : l'index reste une preuve partielle, sans garantie sur tous les effets SQL. Le typage backend ciblé ne vaut pas un build complet de l’application ; les tests React adaptés ne valent pas un essai sur appareil natif. La tête finale, ses empreintes et sa réception CI doivent être rapprochées avant toute intégration ultérieure.

## Préparation de l’activation ultérieure

Cette branche n’active aucune migration ou opération réelle. Son intégration sur une cible demande une réception distincte, menée par le responsable de cette cible avec sauvegarde et retour arrière adaptés.

L’ancien cron de concours et les anciens écrivains financiers doivent être arrêtés avant de faire coexister de nouveaux reçus et leurs effets. Les migrations additives sont à qualifier dans l’ordre `0004` à `0007`, avec les handlers correspondants. Les procédures Stripe de cutover et de rapprochement historique restent celles de son README ; aucun état historique n’est réputé reçu du seul fait de la migration.

Pour les concours, **toute ligne antérieure sans `payout_tracking_started_at` reste bloquée**, même en l’absence de transaction de prix visible. L’ancien handler pouvait avoir crédité un solde sans journal ou laissé l’inverse. Une lecture vide ne permet donc pas d’ajouter automatiquement un marqueur ni de distribuer à nouveau. Le responsable doit rapprocher concours, journaux, soldes et éventuels reçus avant de décider du traitement de chaque cas. Les montants et concours historiques ne sont pas réécrits par le correctif.

Après réception d’une cible, un conflit de verrou ou un règlement incertain doit conserver son statut explicite et reprendre par le même concours ou événement. Le rollback transactionnel et les reçus évitent les effets partiels ; ils ne constituent pas une garantie d’absence de conflit de disponibilité. Les tests de concurrence hébergés et le parcours complet sur la cible restent nécessaires avant toute déclaration de fonctionnement en production.
