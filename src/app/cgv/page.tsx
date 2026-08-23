import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Conditions Générales de Vente — PURAMA Aide',
  description: 'CGV de PURAMA Aide par SASU PURAMA.',
}

export default function CGV() {
  return (
    <div className="relative z-10 min-h-screen px-4 py-20">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--cyan)] transition-colors">
          ← Retour à l&apos;accueil
        </Link>

        <h1 className="gradient-text font-[family-name:var(--font-display)] text-3xl font-bold md:text-4xl mb-2">
          Conditions Générales de Vente
        </h1>
        <p className="text-sm text-[var(--text-muted)] mb-12">Dernière mise à jour : 6 avril 2026</p>

        <div className="glass rounded-3xl p-8 md:p-12 space-y-10 text-[var(--text-secondary)] leading-relaxed">

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              1. Objet
            </h2>
            <p>
              Les présentes Conditions Générales de Vente (CGV) régissent les relations commerciales entre SASU PURAMA (ci-après &quot;le Prestataire&quot;) et tout utilisateur souscrivant à un abonnement payant sur la plateforme PURAMA Aide (ci-après &quot;le Client&quot;).
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              2. Prix et facturation
            </h2>
            <p>
              Tous les prix affichés sont indiqués en euros (€), hors taxes (HT). La TVA n&apos;est pas applicable conformément à l&apos;article 293 B du CGI (franchise en base de TVA).
            </p>
            <p className="mt-2">Les abonnements disponibles sont :</p>
            <ul className="mt-3 space-y-1.5 ml-4 list-disc">
              <li>Plan Gratuit : 0 €/mois (consultation des aides détectées en lecture seule, scans limités)</li>
              <li>Plan Premium mensuel : 9,99 €/mois (scans illimités, démarches automatiques, wallet, missions, concours)</li>
              <li>Plan Premium annuel : 83,90 €/an (-30 % vs mensuel)</li>
            </ul>
            <p className="mt-3">
              Tout abonnement payant bénéficie d&apos;une période d&apos;essai gratuite de 14 jours avec accès complet aux fonctionnalités Premium.
            </p>
            <p className="mt-2">
              Les factures sont émises au format PDF et disponibles dans votre espace client. Elles mentionnent obligatoirement la mention &quot;TVA non applicable, art. 293 B du CGI&quot;.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              3. Modalités de paiement
            </h2>
            <p>
              Le paiement est effectué en ligne via la plateforme sécurisée <strong className="text-[var(--text-primary)]">Stripe</strong>, certifiée PCI-DSS niveau 1.
              Les moyens de paiement acceptés sont : carte bancaire (Visa, Mastercard, American Express), PayPal, et Stripe Link.
            </p>
            <p className="mt-2">
              Le paiement est prélevé automatiquement à chaque échéance (mensuelle ou annuelle) selon le plan choisi.
              En cas d&apos;échec de paiement, SASU PURAMA procède à 3 tentatives supplémentaires avant de dégrader le compte au plan Gratuit.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              4. Abonnements et reconduction
            </h2>
            <p>
              Les abonnements PURAMA Aide sont souscrits pour une durée mensuelle ou annuelle et se renouvellent automatiquement à l&apos;échéance, sauf résiliation préalable.
            </p>
            <p className="mt-2">
              Vous recevrez un email de rappel 7 jours avant chaque renouvellement annuel. Vous pouvez modifier ou annuler votre abonnement à tout moment depuis <strong className="text-[var(--text-primary)]">Paramètres → Abonnement</strong>.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              5. Droit de rétractation
            </h2>
            <p>
              Conformément à l&apos;article L. 221-28 3° du Code de la consommation, le Client renonce expressément à son droit de rétractation de 14 jours en validant sa commande et son paiement, dès lors que l&apos;exécution du service (accès aux fonctionnalités Premium) commence avant la fin du délai de rétractation. Cette renonciation est implicite et ne nécessite aucune case à cocher.
            </p>
            <p className="mt-2">
              Tout abonnement bénéficie néanmoins d&apos;une période d&apos;essai gratuite de 14 jours (article 2) pendant laquelle vous pouvez annuler sans frais depuis <strong className="text-[var(--text-primary)]">Paramètres → Abonnement</strong>. Pour toute question relative à un paiement, contactez <a href="mailto:matiss.frasne@gmail.com" className="text-[var(--cyan)] hover:underline">matiss.frasne@gmail.com</a>.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              6. Résiliation
            </h2>
            <p>
              Vous pouvez résilier votre abonnement à tout moment, en 1 clic, depuis <strong className="text-[var(--text-primary)]">Paramètres → Abonnement → Résilier</strong>.
              La résiliation prend effet à la fin de la période en cours. Vous conservez l&apos;accès aux fonctionnalités payantes jusqu&apos;à cette date.
            </p>
            <p className="mt-2">
              Aucun remboursement au prorata n&apos;est effectué pour les résiliations intervenant en cours de période, sauf exercice du droit de rétractation (article 5) ou défaillance grave du service imputable à SASU PURAMA.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              7. Remboursements
            </h2>
            <p>Les remboursements sont accordés dans les cas suivants :</p>
            <ul className="mt-3 space-y-1.5 ml-4 list-disc">
              <li>Annulation pendant la période d&apos;essai gratuite de 14 jours (article 2), avant tout prélèvement</li>
              <li>Double facturation par erreur technique</li>
              <li>Indisponibilité majeure du service (plus de 72h consécutives) imputable à SASU PURAMA</li>
            </ul>
            <p className="mt-3">
              Pour toute demande de remboursement : <a href="mailto:matiss.frasne@gmail.com" className="text-[var(--cyan)] hover:underline">matiss.frasne@gmail.com</a>
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)] mb-4">
              8. Droit applicable
            </h2>
            <p>
              Les présentes CGV sont soumises au droit français. Les litiges seront portés devant les juridictions compétentes du ressort du Tribunal de Commerce de Besançon, sauf dispositions impératives contraires applicables aux consommateurs.
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}
