# Réservation atomique des scans et provenance des estimations

## Contrat du parcours

Un scan fournit des **pistes et des estimations indicatives**. Il ne constitue ni une décision d’éligibilité, ni une preuve de cumulabilité, ni une somme reçue. Le handler ne modifie plus `total_money_recovered`, le portefeuille ou les points. Les anciennes valeurs sont conservées ; les écrans les identifient comme un historique non vérifié. Aucune réconciliation rétroactive n’est exécutée par ce lot.

Le résultat est accepté seulement si sa structure, ses périodes et ses totaux sont cohérents, puis si le reçu sauvegardé correspond à la demande et au propriétaire authentifié. Chaque montant est arrondi au centime avant le calcul :

- projection annuelle : mensualités × 12 + montants annuels + montants ponctuels ;
- total mensuel récurrent : mensualités seulement ;
- tolérance maximale : un centime par total déclaré.

Par exemple, `10,005 €/mois + 25,125 €/an + 5,015 € ponctuels` donne `150,27 €` pour la projection et `10,01 €` par mois. Ce contrôle arithmétique ne démontre aucun droit légal à ces montants.

## Une intention, une réservation, un résultat

Les deux appelants réels créent un UUID et enregistrent la clé avec le contenu et son propriétaire avant le POST. Le web utilise `sessionStorage` et le natif son `SecureStore` existant. La perte d’un accusé de réception conserve la demande. Une nouvelle clé correspond à une nouvelle intention explicite ou à une modification du contenu. Il n’y a aucune relance automatique du fournisseur.

`reserve_scan_v1` verrouille le profil lié à l’utilisateur authentifié, relit son abonnement et compte les essais dans la fenêtre glissante de 24 heures avant d’insérer la réservation. La limite gratuite reste cinq essais. Les essais en cours, échoués ou dont le résultat reste incertain sont comptés. Ce quota d’usage n’est pas un reçu de paiement. Les règles existantes premium et administrateur sont conservées.

La clé est `scans.id`, sans seconde table. Le contenu JSON est comparé structurellement. Une clé déjà utilisée par un autre propriétaire ou avec un autre type/contenu est refusée sans divulguer le scan tiers.

| État de la même intention | Réponse et effet |
| --- | --- |
| Absente, quota disponible | Réservation `processing`, puis un appel fournisseur |
| `processing` | `409 scan_in_progress`, aucun appel fournisseur |
| `failed` | `409 scan_attempt_failed`, aucun appel fournisseur |
| `completed` et reçu valide | `200`, même résultat relu, aucun nouvel essai ni effet annexe |
| Clé ou contenu en conflit | `409 scan_request_conflict`, aucun appel fournisseur |
| Quota épuisé | `429 scan_daily_limit`, aucun appel fournisseur |
| Accusé de réservation incertain | `503 scan_reservation_unconfirmed`, conserver la même clé |
| Accusé de finalisation incertain | `500 scan_save_unconfirmed`, conserver la même clé |

Le token natif Bearer est vérifié par `getUser(token)`. Une erreur d’authentification, un profil non lié à l’utilisateur ou un en-tête explicite invalide bloque le parcours avant le fournisseur. Un token invalide ne retombe pas sur une autre identité provenant des cookies.

`finish_scan_v1` finalise seulement la réservation correspondante. Le résultat et le plancher d’XP existant sont transactionnels : `GREATEST(xp, 100)` conserve une progression supérieure, et le rejeu ne la modifie pas. Situation/onboarding et notification restent des effets annexes ; leur échec produit un avertissement après le succès enregistré, sans autoriser un deuxième appel payant.

## Annulation et réservations abandonnées

Le handler impose une échéance de 100 secondes, transmet le signal d’annulation au SDK Anthropic et désactive ses reprises HTTP implicites pour ce seul scan (`maxRetries: 0`). Le wrapper observe le résultat tardif sans le finaliser après interruption. Les autres usages du SDK conservent leurs paramètres.

Chaque nouvelle réservation possède une échéance de cinq minutes. L’expiration est matérialisée uniquement lors d’un passage autorisé du service : la réservation demandée est vérifiée, et au plus 50 autres réservations expirées du même profil sont fermées par admission. Un simple SELECT client ne nettoie rien. Les anciennes lignes `processing` sans échéance restent inchangées et ne sont pas assimilées à une réservation nouvelle.

Une annulation réseau ne prouve pas que le fournisseur n’a rien facturé. La réservation demeure comptée pendant 24 heures et sa clé ne relance jamais le fournisseur. Aucun remboursement, renouvellement automatique ou récupération de résultat externe n’est inventé.

## Migration et accès

La migration additive `0006_scan_admission.sql` conserve le schéma et les historiques existants. Elle ajoute les métadonnées de réservation et les deux RPC serveur. Les clients conservent leurs politiques SELECT ; leurs mutations directes des scans sont retirées. Les RPC ne sont exécutables que par `service_role`. Un droit effectif hérité inattendu provoque un échec de la migration.

L’inventaire préalable des appelants a confirmé que l’écriture applicative des scans appartenait au handler. Les autres accès applicatifs sont des lectures. Les migrations `0004`, `0005` et `0006` sont testées dans leur ordre et en réapplication ; elles ne sont pas exécutées sur une cible distante par la publication de cette branche.

## Preuves et commandes

Les tests de route chargent les vrais fichiers TypeScript, Zod et `NextResponse`. Seules les frontières d’identité, de stockage et du fournisseur sont simulées. Le double de réservation permet des ordonnancements adverses, mais n’est pas présenté comme une preuve de concurrence PostgreSQL.

```sh
VIDA_AIDE_VERIFICATION_NODE_MODULES="$PWD/verification/node_modules" \
  node --test --test-concurrency=1 \
  verification/scan/scan-*.test.cjs verification/scan/provider-controls.test.cjs
```

La recette SQL crée un cluster neuf à partir de binaires PostgreSQL existants, charge le vrai `schema.sql` et les migrations, puis exécute le serveur officiel en mode mono-utilisateur, sans socket ni URL distante. Les arguments RPC sont également produits par le vrai handler. Elle conserve le reçu, les empreintes des sources, les journaux et les contre-épreuves, puis supprime le cluster.

```sh
VIDA_AIDE_VERIFICATION_NODE_MODULES="$PWD/verification/node_modules" \
  python3 verification/scan-quota/run-postgres.py \
  --pg-bin-dir /chemin/postgresql/bin --evidence-dir /chemin/preuves/scan
```

**PASS local : 87 tests scan, deux tests du vrai SDK avec transport synthétique et 16 cas SQL sur PostgreSQL 18.7.** La contre-épreuve initiale du quota acceptait deux appels fournisseur pour une seule place ; après correction, le test du vrai handler n’en accepte qu’un. Les cas SQL couvrent notamment la dernière place, les périodes mixtes et les décimaux, les clés, les propriétaires, les états échoués, la fenêtre glissante, l’expiration bornée, les droits RLS, le rollback après écriture du résultat, les XP et la conservation des historiques.

Le gate multi-session est distinct et ne doit être exécuté que dans un environnement autorisant son serveur local jetable. Il utilise des connexions et des PID distincts, attend d’observer simultanément les blocages SQL puis libère le verrou contrôlé. Il relie aussi de vrais POST aux vrais RPC PostgreSQL pour compter les appels fournisseur synthétiques.

```sh
VIDA_AIDE_VERIFICATION_NODE_MODULES="$PWD/verification/node_modules" \
  node verification/scan-quota/concurrency.cjs \
  --pg-bin-dir /chemin/postgresql/bin --evidence-dir /chemin/court/preuves
```

**Concurrence réelle : NON TESTÉ localement**, en attente du reçu CI. Les contrôles syntaxiques et les revues du gate ne remplacent pas son exécution. Aucun build complet, appareil natif, fournisseur réel, migration distante ou déploiement n’est qualifié par ces tests.
