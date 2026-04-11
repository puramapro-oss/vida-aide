'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Search, MessageSquare, Wallet, TrendingUp, Sparkles, ArrowRight, Trophy } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import { formatEuros, formatPoints, levelFromXp } from '@/lib/utils'
import Card from '@/components/ui/Card'
import AnimatedCounter from '@/components/ui/AnimatedCounter'
import type { Scan } from '@/types'

export default function DashboardPage() {
  const { profile } = useAuth()
  const [recentScans, setRecentScans] = useState<Scan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    const sb = createClient()
    sb.from('scans')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(3)
      .then(({ data }) => {
        setRecentScans((data ?? []) as Scan[])
        setLoading(false)
      })
  }, [profile])

  if (!profile) return null

  const lvl = levelFromXp(profile.xp ?? 0)
  const totalRecovered = Number(profile.total_money_recovered ?? 0)
  const lastScan = recentScans[0]

  return (
    <div className="mx-auto max-w-6xl space-y-8" data-testid="dashboard-page">
      {/* Hero compteur */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass relative overflow-hidden rounded-3xl border border-[var(--border)] p-8 lg:p-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--cyan)]/10 via-transparent to-[var(--purple)]/10" aria-hidden />
        <div className="relative">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">Argent récupérable détecté</p>
          <div className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight text-[var(--text-primary)] lg:text-7xl">
            <AnimatedCounter value={lastScan ? Number(lastScan.total_recoverable) : totalRecovered} suffix=" €" />
          </div>
          <p className="mt-3 max-w-xl text-sm text-[var(--text-secondary)] lg:text-base">
            {lastScan
              ? `${lastScan.results.length} aides détectées dans ton dernier scan. Lance les démarches pour récupérer cet argent.`
              : "Lance ton premier scan financier pour découvrir tout ce que tu peux récupérer."}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/scanner"
              data-testid="cta-scan"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:scale-[1.02]"
            >
              <Search className="h-4 w-4" />
              {lastScan ? 'Nouveau scan' : 'Lancer mon premier scan'}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/5 px-6 py-3 text-sm font-medium text-[var(--text-primary)] hover:bg-white/10"
            >
              <MessageSquare className="h-4 w-4" />
              Poser une question
            </Link>
          </div>
        </div>
      </motion.section>

      {/* Stats grid */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wallet} label="Wallet" value={formatEuros(Number(profile.wallet_balance ?? 0))} accent="cyan" href="/dashboard/wallet" />
        <StatCard icon={Sparkles} label="Points PURAMA" value={formatPoints(profile.purama_points ?? 0)} accent="purple" href="/dashboard/missions" />
        <StatCard icon={TrendingUp} label="Démarches lancées" value={String(profile.total_demarches_launched ?? 0)} accent="green" href="/dashboard/missions" />
        <StatCard icon={Trophy} label={`${lvl.name} ${lvl.emoji}`} value={`Niv. ${lvl.id}`} accent="gold" href="/dashboard/profile" />
      </section>

      {/* Récents scans */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">Tes derniers scans</h2>
          <Link href="/scanner" className="text-sm text-[var(--cyan)] hover:underline">
            Voir tout
          </Link>
        </div>
        {loading ? (
          <Card className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement…</Card>
        ) : recentScans.length === 0 ? (
          <Card className="p-8 text-center">
            <Search className="mx-auto mb-3 h-10 w-10 text-[var(--cyan)]/60" />
            <p className="text-sm text-[var(--text-secondary)]">Aucun scan pour l&apos;instant.</p>
            <Link
              href="/scanner"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Lancer un scan <ArrowRight className="h-4 w-4" />
            </Link>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentScans.map((scan) => (
              <Link
                key={scan.id}
                href={`/scanner/${scan.id}`}
                className="group glass rounded-2xl border border-[var(--border)] p-5 transition-all hover:border-[var(--cyan)]/40 hover:bg-white/5"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded-full bg-[var(--cyan)]/10 px-2 py-0.5 text-xs font-medium text-[var(--cyan)]">
                    {scanTypeLabel(scan.type)}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {new Date(scan.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div className="mb-1 font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)]">
                  {formatEuros(Number(scan.total_recoverable))}
                </div>
                <p className="text-xs text-[var(--text-muted)]">{scan.results.length} aides détectées</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function scanTypeLabel(type: string): string {
  if (type === 'financial') return '💰 Financier'
  if (type === 'fiscal') return '📊 Fiscal'
  if (type === 'forgotten_money') return '💸 Argent oublié'
  return '⚖️ Juridique'
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  href,
}: {
  icon: typeof Wallet
  label: string
  value: string
  accent: 'cyan' | 'purple' | 'green' | 'gold'
  href: string
}) {
  const colors = {
    cyan: 'from-[var(--cyan)]/20 to-[var(--cyan)]/5 text-[var(--cyan)]',
    purple: 'from-[var(--purple)]/20 to-[var(--purple)]/5 text-[var(--purple)]',
    green: 'from-emerald-500/20 to-emerald-500/5 text-emerald-400',
    gold: 'from-amber-500/20 to-amber-500/5 text-amber-400',
  }
  return (
    <Link
      href={href}
      className="glass group rounded-2xl border border-[var(--border)] p-5 transition-all hover:border-white/15"
    >
      <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${colors[accent]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
    </Link>
  )
}
