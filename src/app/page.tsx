'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import {
  Menu, X, Search, MessageSquare, Wallet, Trophy, Sparkles,
  Check, ArrowRight, Coins, Building2, Scale, Zap, Shield, Globe,
} from 'lucide-react'
import { AIDE_CATEGORIES, CORRIDORS_FRONTALIERS } from '@/lib/constants'
import LocaleSwitcher from '@/components/shared/LocaleSwitcher'

function Nav() {
  const t = useTranslations('vidaaide')
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
        scrolled ? 'backdrop-blur-xl bg-[rgba(4,18,12,0.85)] border-b border-white/[0.06]' : 'bg-transparent'
      }`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">💰</span>
            <span className="font-[family-name:var(--font-display)] text-xl font-bold gradient-text">PURAMA Aide</span>
          </Link>
          <div className="hidden items-center gap-8 lg:flex">
            <Link href="#features" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{t('navHow')}</Link>
            <Link href="#aides" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{t('navAides')}</Link>
            <Link href="#frontaliers" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{t('navFrontaliers')}</Link>
            <Link href="/pricing" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{t('navPricing')}</Link>
            <LocaleSwitcher compact />
            <Link href="/login" className="text-sm font-medium text-[var(--text-primary)]">{t('loginCta')}</Link>
            <Link
              href="/signup"
              className="rounded-xl bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)] px-5 py-2 text-sm font-semibold text-white shadow-lg"
            >
              {t('trialCta')}
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="lg:hidden text-[var(--text-primary)]"
            aria-label="Menu"
          >
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-white/[0.06] py-4 lg:hidden">
            <div className="flex flex-col gap-3">
              <Link href="#features" onClick={() => setMenuOpen(false)} className="text-sm text-[var(--text-secondary)]">{t('navHow')}</Link>
              <Link href="#aides" onClick={() => setMenuOpen(false)} className="text-sm text-[var(--text-secondary)]">{t('navAides')}</Link>
              <Link href="/pricing" onClick={() => setMenuOpen(false)} className="text-sm text-[var(--text-secondary)]">{t('navPricing')}</Link>
              <div className="py-1"><LocaleSwitcher /></div>
              <Link href="/login" onClick={() => setMenuOpen(false)} className="text-sm text-[var(--text-primary)]">{t('loginCta')}</Link>
              <Link
                href="/signup"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)] px-5 py-2.5 text-center text-sm font-semibold text-white"
              >
                {t('trialCta')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

function Hero() {
  const t = useTranslations('vidaaide')
  return (
    <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32">
      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/5 px-4 py-1.5 text-xs font-medium text-emerald-300"
        >
          <Sparkles className="h-3 w-3" /> {t('heroBadge')}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.05] tracking-tight text-[var(--text-primary)] sm:text-6xl lg:text-7xl"
        >
          <span className="gradient-text">{t('tagline')}</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mt-6 max-w-2xl text-base text-[var(--text-secondary)] sm:text-lg"
        >
          {t('heroSubtitle')}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/signup"
            data-testid="hero-cta"
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)] px-8 py-4 text-base font-semibold text-white shadow-2xl shadow-[var(--cyan)]/30 transition-all hover:scale-[1.03]"
          >
            <Search className="h-5 w-5" />
            {t('ctaPrimary')}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white/5 px-8 py-4 text-base font-medium text-[var(--text-primary)] hover:bg-white/10"
          >
            {t('ctaSecondary')}
          </Link>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-4 text-xs text-[var(--text-muted)]"
        >
          {t('trialNote')}
        </motion.p>

        {/* Trust badges */}
        <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { icon: Shield, label: 'RGPD' },
            { icon: Zap, label: 'Scan en 10 sec' },
            { icon: Globe, label: '8 corridors frontaliers' },
            { icon: Sparkles, label: 'IA française' },
          ].map((b) => (
            <div key={b.label} className="glass flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-xs text-[var(--text-secondary)]">
              <b.icon className="h-4 w-4 shrink-0 text-[var(--cyan)]" />
              <span>{b.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Features() {
  const features = [
    {
      icon: Search,
      title: '1. Décris ta situation',
      body: '4 questions rapides : âge, revenus, logement, situation familiale. AideIA te comprend en 30 secondes.',
    },
    {
      icon: Sparkles,
      title: '2. AideIA scanne tes droits',
      body: 'En 10 secondes, IA analyse 200+ aides françaises et conventions fiscales. Tu vois le montant total récupérable.',
    },
    {
      icon: Coins,
      title: '3. Lance les démarches',
      body: '1 clic pour activer chaque demande. Lettres pré-remplies, rappels automatiques, suivi en temps réel.',
    },
    {
      icon: Wallet,
      title: '4. Encaisse',
      body: "L'argent récupéré atterrit sur ton compte. Tu reçois aussi des points et des places aux concours hebdo.",
    },
  ]

  return (
    <section id="features" className="py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)] sm:text-5xl">
            Comment ça marche
          </h2>
          <p className="mt-4 text-base text-[var(--text-secondary)]">
            En 2 minutes, tu sais combien tu peux récupérer. En 1 clic, tu lances les démarches.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="glass relative rounded-2xl border border-[var(--border)] p-6"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--cyan)]/20 to-[var(--purple)]/20">
                <f.icon className="h-6 w-6 text-[var(--cyan)]" />
              </div>
              <h3 className="mb-2 font-[family-name:var(--font-display)] text-lg font-bold text-[var(--text-primary)]">{f.title}</h3>
              <p className="text-sm text-[var(--text-secondary)]">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Aides() {
  return (
    <section id="aides" className="py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)] sm:text-5xl">
            14 catégories. 200+ aides.
          </h2>
          <p className="mt-4 text-base text-[var(--text-secondary)]">
            AideIA connaît tous les organismes et toutes les conditions d&apos;éligibilité.
          </p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AIDE_CATEGORIES.map((c) => (
            <div key={c.id} className="glass flex items-start gap-3 rounded-2xl border border-[var(--border)] p-4">
              <span className="text-2xl">{c.icon}</span>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--text-primary)]">{c.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{c.examples}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Frontaliers() {
  return (
    <section id="frontaliers" className="py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/5 px-3 py-1 text-xs font-medium text-amber-300">
              <Globe className="h-3 w-3" /> 8 corridors frontaliers
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)] sm:text-5xl">
              Frontaliers : on te comprend.
            </h2>
            <p className="mt-4 text-base text-[var(--text-secondary)]">
              Convention fiscale, télétravail, double imposition, quasi-résident, forfait. AideIA maîtrise les
              accords avec la Suisse, le Luxembourg, l&apos;Allemagne, la Belgique, l&apos;Italie, l&apos;Espagne, Monaco et l&apos;Andorre.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {CORRIDORS_FRONTALIERS.map((c) => (
              <div key={c.id} className="glass rounded-2xl border border-[var(--border)] p-4 text-center">
                <div className="text-3xl">{c.flag}</div>
                <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{c.name}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{c.notes}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Modules() {
  const modules = [
    { icon: Search, title: 'Scanner financier', desc: '200+ aides françaises CAF, CPAM, Pôle Emploi, MDPH, CARSAT' },
    { icon: Building2, title: 'Optimisation fiscale', desc: 'Crédits d\'impôt, déductions, frontaliers (8 conventions)' },
    { icon: Coins, title: 'Argent oublié', desc: 'Ciclade, assurances vie, trop-perçus, frais bancaires abusifs' },
    { icon: Scale, title: 'Assistant juridique', desc: 'Travail, logement, conso, famille — articles de loi cités' },
    { icon: Trophy, title: 'Concours hebdo', desc: '10 gagnants par tirage. Premium = x5 places' },
    { icon: MessageSquare, title: 'Chat 24/7', desc: 'AideIA répond instantanément avec les bonnes sources' },
  ]
  return (
    <section className="py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)] sm:text-5xl">
            6 modules. 1 abonnement.
          </h2>
          <p className="mt-4 text-base text-[var(--text-secondary)]">
            Tout ce qu&apos;il faut pour récupérer ce qui te revient et défendre tes droits.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <div key={m.title} className="glass rounded-2xl border border-[var(--border)] p-6">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--cyan)]/20 to-[var(--purple)]/20">
                <m.icon className="h-5 w-5 text-[var(--cyan)]" />
              </div>
              <h3 className="font-semibold text-[var(--text-primary)]">{m.title}</h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section className="py-20 lg:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="glass relative overflow-hidden rounded-3xl border border-[var(--border)] p-10 text-center lg:p-16">
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--cyan)]/10 via-transparent to-[var(--purple)]/10" aria-hidden />
          <div className="relative">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)] sm:text-5xl">
              Et si tu commençais maintenant ?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-[var(--text-secondary)]">
              14 jours d&apos;essai. Pas besoin de carte. Tu vois ton montant récupérable avant même de payer.
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)] px-8 py-4 text-base font-semibold text-white shadow-2xl shadow-[var(--cyan)]/30 transition-all hover:scale-[1.03]"
            >
              <Search className="h-5 w-5" />
              Lancer mon scan gratuit
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-5">
          <div>
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl">💰</span>
              <span className="font-[family-name:var(--font-display)] text-lg font-bold gradient-text">PURAMA Aide</span>
            </Link>
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Récupère tout l&apos;argent que tu laisses sur la table.
            </p>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">Produit</p>
            <ul className="space-y-1.5 text-sm text-[var(--text-muted)]">
              <li><Link href="/pricing" className="hover:text-[var(--text-primary)]">Tarif</Link></li>
              <li><Link href="/signup" className="hover:text-[var(--text-primary)]">Inscription</Link></li>
              <li><Link href="/login" className="hover:text-[var(--text-primary)]">Connexion</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">Support</p>
            <ul className="space-y-1.5 text-sm text-[var(--text-muted)]">
              <li><Link href="/aide" className="hover:text-[var(--text-primary)]">Centre d&apos;aide</Link></li>
              <li><Link href="/contact" className="hover:text-[var(--text-primary)]">Nous contacter</Link></li>
              <li><a href="mailto:contact@purama.dev" className="hover:text-[var(--text-primary)]">contact@purama.dev</a></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">Légal</p>
            <ul className="space-y-1.5 text-sm text-[var(--text-muted)]">
              <li><Link href="/mentions-legales" className="hover:text-[var(--text-primary)]">Mentions légales</Link></li>
              <li><Link href="/politique-confidentialite" className="hover:text-[var(--text-primary)]">Confidentialité</Link></li>
              <li><Link href="/cgv" className="hover:text-[var(--text-primary)]">CGV</Link></li>
              <li><Link href="/cgu" className="hover:text-[var(--text-primary)]">CGU</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">PURAMA</p>
            <ul className="space-y-1.5 text-sm text-[var(--text-muted)]">
              <li>SASU PURAMA</li>
              <li>Frasne, France</li>
              <li>art. 293 B CGI</li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-white/[0.06] pt-6 text-center text-xs text-[var(--text-muted)]">
          © {new Date().getFullYear()} PURAMA Aide — Tous droits réservés.
        </div>
      </div>
    </footer>
  )
}

export default function Home() {
  return (
    <div data-testid="landing-page">
      <Nav />
      <Hero />
      <Features />
      <Aides />
      <Frontaliers />
      <Modules />
      <Cta />
      <Footer />
    </div>
  )
}
