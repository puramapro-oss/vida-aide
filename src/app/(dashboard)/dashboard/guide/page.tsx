'use client'

import Link from 'next/link'
import { Search, MessageSquare, Wallet, Trophy, Sparkles, BookOpen } from 'lucide-react'
import Card from '@/components/ui/Card'

const SECTIONS = [
  {
    icon: Search,
    title: '1. Lance ton premier scan',
    body: "Va dans Scanner. Renseigne ta situation (âge, emploi, revenus, logement). AideIA détecte en 10 sec toutes les aides auxquelles tu as droit, avec montants exacts.",
    href: '/scanner',
    cta: 'Aller au scanner',
  },
  {
    icon: MessageSquare,
    title: '2. Pose toutes tes questions',
    body: "Question juridique, fiscale, administrative ? Le chat AideIA te répond avec les bons articles de loi et calcule tes indemnités. Frontaliers : 8 conventions fiscales gérées.",
    href: '/chat',
    cta: 'Ouvrir AideIA',
  },
  {
    icon: Sparkles,
    title: '3. Réalise des missions',
    body: "Noter l'app, partager, parrainer un ami : chaque action te rapporte des points et des places aux concours. Certaines missions paient en €.",
    href: '/dashboard/missions',
    cta: 'Voir les missions',
  },
  {
    icon: Wallet,
    title: '4. Encaisse tes gains',
    body: "Mission, parrainage, redistribution… tout va dans ton wallet. Retrait sur IBAN dès 5 €.",
    href: '/dashboard/wallet',
    cta: 'Mon wallet',
  },
  {
    icon: Trophy,
    title: '5. Joue aux concours',
    body: "10 gagnants par concours hebdo / mensuel / annuel. Abonnés Premium = x5 places automatiquement. Tirage 100% transparent.",
    href: '/dashboard/concours',
    cta: 'Voir les concours',
  },
]

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="guide-page">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)]">Guide PURAMA Aide</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">5 étapes pour récupérer tout l&apos;argent qui te revient.</p>
      </header>

      {SECTIONS.map((s) => (
        <Card key={s.href} className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--cyan)]/20 to-[var(--purple)]/20">
              <s.icon className="h-5 w-5 text-[var(--cyan)]" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="mb-1 font-semibold text-[var(--text-primary)]">{s.title}</h2>
              <p className="text-sm text-[var(--text-secondary)]">{s.body}</p>
              <Link
                href={s.href}
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--cyan)] hover:underline"
              >
                {s.cta} →
              </Link>
            </div>
          </div>
        </Card>
      ))}

      <Card className="p-6">
        <BookOpen className="mb-2 h-6 w-6 text-[var(--cyan)]" />
        <p className="text-sm text-[var(--text-secondary)]">
          Une question ? Le chat <Link href="/chat" className="text-[var(--cyan)] hover:underline">AideIA</Link> est là 24/7.
        </p>
      </Card>
    </div>
  )
}
