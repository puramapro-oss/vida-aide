# Règlement atomique du concours hebdomadaire

## Résultat reçu localement

- **PASS — 50 tests du vrai handler** : classement et dix pourcentages conservés, scans terminés seuls, centimes/arrondis, reste non redistribué, lectures défaillantes, identités étrangères, reçus invalides et traitement indépendant des concours.
- **PASS — 19 cas métier, 32 phases PostgreSQL natives** : reçu produit avec les arguments du vrai handler, règlement durable, rejeu, rollback de la dernière notification et de la clôture finale, droits effectifs, montants/rangs, anciennes données et réapplication des migrations.
- **DÉFAUT ORIGINAL REPRODUIT** : le handler extrait sans modification du commit `af8eda90be63dba1592f347a9356b85fc0144b55` répond deux fois `200 / ok:true` alors que la clôture simulée échoue. Il répète deux prix de 33 €, garde le concours ouvert et fait passer le solde de 25,50 € à 91,50 €. Cette contre-épreuve utilise des réponses de persistance synthétiques ; elle ne constitue pas un essai PostgreSQL.
- **NON TESTÉ — concurrence réelle** : `concurrency.cjs` est préparé et sa syntaxe est vérifiée. Seule son exécution en CI, avec connexions distinctes et attentes de verrou effectivement observées, pourra qualifier ses deux scénarios.

Les résultats, empreintes et journaux sont copiés dans `evidence/`. `local-receipt.json` les rapproche. Ils ne valent pas résultat CI ni déploiement. Aucun fournisseur, versement, compte externe ou base distante n'a été utilisé.

## Frontières de vérification

`harness.cjs` compile le fichier réel `src/app/api/cron/contest-weekly/route.ts` avec Next, Zod et TypeScript. L'acquisition du client Supabase et ses lectures sont des fixtures explicites. Toute mutation directe via `.from()` fait échouer le harnais. Les tests HTTP simulent la réponse RPC pour éprouver les refus de faux succès ; ils ne prouvent pas, seuls, la transaction.

`emit-fixture.cjs` extrait les arguments exacts de l'unique appel `settle_weekly_contest_v1`. `run-postgres.py` les applique à la vraie migration 0007, après le schéma historique et les migrations 0004–0006, dans un cluster neuf. Des données historiques sont insérées **avant** la migration : concours sans écriture financière, ancien versement partiel, notification et profils. Elles restent intactes. Les anciens concours gardent leur marqueur `NULL` et ne sont pas réglés implicitement.

Le runner calibre les OID ordinaires au-dessus de 16384 puis exige une RLS active sous un rôle `authenticated` sans privilèges de superutilisateur ni contournement RLS. Il lit aussi les erreurs PostgreSQL, car le mode single-user peut renvoyer un code de sortie nul malgré une erreur SQL. L'échec attendu d'une migration avec privilège `EXECUTE` hérité est enregistré comme **refus prouvé**, puis les droits synthétiques sont retirés et les contrôles rejoués.

Les injections d'erreur se situent après les effets financiers : dernière notification ou `UPDATE` final du concours. Les assertions vérifient l'annulation des écritures précédentes, pas seulement le code de retour. Le premier règlement est commis ; son rejeu est lu dans une invocation PostgreSQL ultérieure. Les autres cas destructifs sont isolés par transaction puis annulés.

## Commandes

Utiliser les dépendances isolées installées depuis `verification/package-lock.json` ; `VIDA_AIDE_VERIFICATION_NODE_MODULES` désigne leur répertoire `node_modules`.

```sh
NODE_OPTIONS='--preserve-symlinks --max-old-space-size=256' \
  node --test verification/contest-payout/routes.test.cjs

NODE_OPTIONS='--preserve-symlinks --max-old-space-size=256' \
  python3 verification/contest-payout/run-postgres.py \
    --pg-bin-dir /chemin/existant/postgresql/bin \
    --evidence-dir /chemin/neuf/preuves-natives

NODE_OPTIONS='--preserve-symlinks --max-old-space-size=256' \
  node verification/contest-payout/concurrency.cjs \
    --pg-bin-dir /chemin/existant/postgresql/bin \
    --evidence-dir /tmp/vida-contest-ci
```

Le dernier chemin doit rester court pour respecter la limite du socket UNIX. Le lanceur partagé crée son propre cluster et son propre socket, désactive TCP, vérifie l'arrêt du serveur avant suppression et conserve les journaux et sources exactes. Il n'accepte aucune URL de base distante.

Les deux scénarios CI relient chacun deux vrais handlers à deux clients PostgreSQL : même concours → un règlement et un reçu de rejeu ; concours distincts partageant un bénéficiaire → deux additions conservées dans le même solde. Les lectures métier et l'autorisation cron restent synthétiques. Les montants du ledger, chaque reçu, les notifications et les données historiques sont vérifiés après les deux scénarios.

## Limites précises

La recette locale utilise PostgreSQL 18.7 en mode single-user et les dépendances backend exactes déjà isolées ; elle ne prouve pas une concurrence de sessions ni un déploiement Supabase. Le binaire initialement référencé sous `/tmp` n'était plus présent ; le premier échec est conservé. Une copie existante de PostgreSQL 18.7 a ensuite été utilisée après vérification du même SHA-256.

Le croisement du verrouillage Stripe et du règlement d'un concours n'est pas couvert par ces deux scénarios de concurrence. Un interblocage pourrait annuler l'une des transactions et nécessiter une reprise ; aucun versement partiel ne doit alors être présenté comme réussi. Cette observation statique n'est pas déclarée reproduite.

Aucune migration distante, aucun concours réel et aucun versement réel n'ont été exécutés. Les historiques ambigus nécessitent un rapprochement explicite ; la migration ne les complète pas rétroactivement.
