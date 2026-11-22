# Traitement Stripe : reçu atomique et crédits uniques

## Périmètre

Les routes publiques `/api/stripe/webhook` et internes `/api/internal/stripe-fulfillment` exécutent maintenant le même code et la même transaction PostgreSQL. Les tarifs, la durée d’essai et la commission existante de 50 % ne changent pas. Aucun compte Stripe réel, paiement, remboursement, portefeuille distant ou déploiement n’a été utilisé pour cette recette.

Le handler vérifie la signature sur le corps brut. Le relais exige également un secret interne configuré et correct. Les événements d’autres applications ne modifient pas Aide. La réponse 2xx d’un événement traité exige un reçu de base validé, lié à l’événement, au corps signé, à l’objet Stripe et au profil attendu. Les erreurs de persistance, les réponses ambiguës et les reçus incohérents renvoient 500 avec un message public neutre.

### Transaction

`0005_stripe_atomic_fulfillment.sql` réutilise `stripe_events`, ajoute un hash et un reçu, et applique dans une transaction unique :

- l’identité de l’événement et la réservation de sa clé unique ;
- la liaison du client Stripe et l’état d’abonnement ;
- le paiement réellement confirmé par le statut de Checkout ;
- le crédit du portefeuille, son écriture justificative et sa notification ;
- le reçu final et la nouvelle révision du profil.

Une erreur sur le dernier effet annule également les premiers effets et l’enregistrement de l’événement. Le même événement peut donc être retenté. Un événement déjà confirmé renvoie le reçu conservé sans rejouer les effets. Des événements différents portant sur une même session sont dédupliqués par des clés uniques de session sur `payments` et `wallet_transactions`. Les additions au portefeuille s’effectuent en SQL sur la valeur courante.

`checkout.session.completed` peut représenter un paiement encore impayé. Ce cas conserve un reçu différé et ne crédite rien ; un événement `checkout.session.async_payment_succeeded` confirmé peut ensuite traiter la même session. Un essai sans paiement ouvre les droits selon l’état d’abonnement, mais ne fabrique pas un paiement à partir du prix catalogue. Les événements d’abonnement ne sont plus enregistrés comme des paiements réussis sur la seule base de leur prix.

### Identité et ordre des lectures

Les nouvelles sessions et leurs abonnements portent le `profile_id` lu côté serveur après authentification. Un identifiant ou une adresse fournie dans le corps de la demande ne peut pas choisir le bénéficiaire. Un abonnement existant sans cette métadonnée peut être retrouvé par un client Stripe déjà lié de façon unique. Il n’existe plus de liaison aveugle par adresse e-mail dans le fulfillment.

Le serveur lit `stripe_state_revision` **avant** de relire les objets Stripe. La transaction verrouille ensuite le profil et exige la même révision. Une autre mise à jour intervenue entre ces deux moments fait échouer la transaction avec `40001` ; le prochain traitement doit relire le profil puis Stripe. Les timestamps d’événements ne servent pas à ordonner les changements.

Un événement relatif à un abonnement remplacé est reçu comme ignoré et ne révoque pas l’abonnement courant. Remplacer l’abonnement courant par un autre Checkout exige une relecture de l’ancien abonnement montrant un état terminal `canceled` ou `incomplete_expired`, et la révision doit toujours correspondre. Deux abonnements actifs concurrents nécessitent un rapprochement explicite.

### Historique et date d’activation

Les anciennes lignes de `stripe_events` prouvent seulement une réception : l’ancien relais les écrivait avant ses effets. Elles restent inchangées et ne sont ni acquittées comme succès démontré ni rejouées automatiquement.

L’ancien handler public ne conservait aucune clé d’événement ou de session. Il est impossible de déduire sans preuve quels anciens crédits ont déjà été appliqués. La migration conserve donc une date d’activation, lisible mais non modifiable par `service_role`. Un nouvel événement financier dont l’événement **ou la session** a été créé avant cette date exige un rapprochement. Réappliquer la migration ne change pas cette date. Ce garde ne prétend pas corriger l’historique.

Le propriétaire du schéma conserve ses prérogatives d’administration. La date est protégée contre les écritures de l’application, pas contre une intervention volontaire de ce propriétaire. Ne pas la reculer pour débloquer en masse des événements : les anciens crédits publics ne sont pas traçables par session.

## Preuves locales

- **44 tests HTTP PASS** : véritables routes, helpers, NextResponse, Zod, SHA256, vérification cryptographique Stripe hors réseau ; les lectures des fournisseurs et la base sont simulées à leurs frontières. Huit tests exécutent également le vrai code de création de Checkout avec le client Stripe remplacé à sa frontière.
- **16 scénarios métier PostgreSQL PASS** sur un cluster natif neuf PostgreSQL 18.7 en mode single-user, plus installation, réapplication et vérification finale des droits et de l’historique. La fixture RPC initiale provient du vrai handler avec une signature de test. Les scénarios modifient uniquement des identifiants et montants synthétiques.
- Contre-épreuve indépendante : un ancien lecteur `active` ne peut plus rétablir Premium après une annulation validée ; son insertion d’événement est annulée. Le vrai rôle `service_role` ne peut pas modifier la date d’activation. Les clients ne peuvent ni appeler la fonction ni modifier la nouvelle révision.
- Les clusters locaux ont été supprimés après arrêt des processus. Aucun socket ni service réseau PostgreSQL n’a été démarré pour ces preuves.

La première exécution utilisait le SDK Stripe 22.3.2 disponible. La recette finale des 44 tests HTTP et16 scénarios SQL a ensuite été rejouée avec **Stripe 22.0.0 exact**, extrait du cache hors ligne et vérifié par le SRI du verrou produit. Next 16.2.11, Zod 4.3.6 et TypeScript 5.9.3 correspondent aussi au verrou ; le reçu SQL final les identifie. La concurrence réelle, PostgreSQL 16 en CI, le build complet et le comportement distant restent à qualifier sur le commit publié ; aucune concurrence multi-session n’est revendiquée à partir des seuls scénarios séquentiels.

Le montage backend isolé final comporte 53 manifestes exacts et 55 arêtes de résolution transitives vérifiées, sans réseau ni modification des dépendances anciennes. Les 44 tests HTTP et le typage strict Stripe (0 diagnostic) ont passé sur ce banc. Une discordance de métadonnées de l’artefact Stripe a été conservée : son manifeste verrouillé indique 22.0.0, tandis que sa constante interne PACKAGE_VERSION indique 21.0.1. Le SRI du tarball et les octets du fichier sont identiques au verrou ; le SDK n’a pas été modifié. La preuve décrit l’artefact exécuté, sans affirmer que cette constante interne est correcte. Voir `verification/evidence/stripe-artifact-metadata.json` et `backend-runtime-assembly.json`.

Les reçus locaux sont conservés dans `verification/evidence/stripe-postgres-single.json` et `verification/evidence/stripe-independent-review.json`. Ils indiquent les empreintes des sources réellement exécutées, le runtime, les cas et les limites.

## Reproduire dans un environnement de test

Installer le banc isolé avec son verrou, puis définir `VIDA_AIDE_VERIFICATION_NODE_MODULES` sur son répertoire `node_modules`. Le banc ne requiert aucun secret de production.

```sh
npm ci --prefix verification
export VIDA_AIDE_VERIFICATION_NODE_MODULES="$PWD/verification/node_modules"
node --test verification/stripe-fulfillment/*.test.cjs
python3 verification/stripe-fulfillment/run-postgres.py \
  --pg-bin-dir /usr/lib/postgresql/16/bin \
  --evidence-dir /tmp/vida-aide-stripe-proof
```

Le script SQL exige un runtime PostgreSQL déjà installé et crée lui-même une nouvelle base jetable. Il refuse de réutiliser un schéma applicatif existant. Sa recette rapporte la version réellement exécutée.

## Conditions avant mise en service

1. Qualifier le commit exact en CI, y compris le gate de concurrence réelle, puis revoir les changements de schéma et les droits avec l’exploitant de la base.
2. Rechercher les associations Stripe ambiguës existantes. L’index unique sur `stripe_customer_id` fait échouer la migration en présence de doublons au lieu de choisir arbitrairement un profil.
3. Prévoir une fenêtre coordonnée : interrompre les créations Checkout et les deux anciens handlers financiers, laisser leurs traitements en cours se terminer, appliquer les migrations, puis activer ensemble les nouvelles routes. Un ancien handler ne doit pas continuer à écrire après la date d’activation.
4. Vérifier la souscription des webhooks aux événements déjà traités et à `checkout.session.async_payment_succeeded`, ainsi que les secrets propres aux destinations. Ces réglages distants ne sont pas modifiés par ce lot.
5. Rapprocher individuellement les sessions antérieures à l’activation et les lignes historiques sans reçu : paiement du fournisseur, bénéficiaire, crédits déjà présents et éventuelles écritures partielles. Ne supprimer aucune preuve et ne recréditer aucune somme sans ce rapprochement.

Ce lot sécurise les parcours existants de Checkout et d’état d’abonnement. Il ne crée pas de nouveau barème de facturation récurrente, de remboursement ou de litige, ni de rapprochement automatique des crédits historiques. La recette n’établit aucun encaissement bancaire réel.

## Sources techniques

Consultées le 22 novembre 2026 :

- Stripe, [réceptions répétées et ordre des événements](https://docs.stripe.com/webhooks).
- Stripe, [fulfillment Checkout, statut de paiement et paiements différés](https://docs.stripe.com/checkout/fulfillment.md?ui=full-page).
- PostgreSQL, [mode single-user](https://www.postgresql.org/docs/18/app-postgres.html).
