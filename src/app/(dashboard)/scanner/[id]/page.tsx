'use client'

import { useEffect, useState, use } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Loader2, ExternalLink, Check, ArrowLeft, Sparkles, Search } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import AnimatedCounter from '@/components/ui/AnimatedCounter'
import ShareStoryButton from '@/components/shared/ShareStoryButton'
import { formatEuros } from '@/lib/utils'
import { AIDE_CATEGORIES } from '@/lib/constants'
import type { Scan, ScanResultItem } from '@/types'

export default function ScanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { profile } = useAuth()
  const [scan, setScan] = useState<Scan | null>(null)
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    const sb = createClient()
    sb.from('scans').select('*').eq('id', id).maybeSingle().then(({ data }) => {
      setScan(data as Scan | null)
      setLoading(false)
    })
  }, [id, profile])

  async function launchDemarche(item: ScanResultItem) {
    if (!profile) return
    setLaunching(item.aide)
    try {
      const res = await fetch('/api/demarches/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan_id: id, aide: item }),
      })
      if (!res.ok) throw new Error()
      toast.success(`Démarche lancée pour ${item.aide} !`)
    } catch {
      toast.error('Impossible de lancer la démarche.')
    } finally {
      setLaunching(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--cyan)]" />
      </div>
    )
  }

  if (!scan) {
    return (
      <Card className="mx-auto max-w-xl p-8 text-center">
        <Search className="mx-auto mb-3 h-10 w-10 text-[var(--text-muted)]" />
        <p className="mb-4 text-sm text-[var(--text-secondary)]">Scan introuvable.</p>
        <Link href="/scanner" className="text-sm text-[var(--cyan)] hover:underline">
          ← Retour au scanner
        </Link>
      </Card>
    )
  }

  const grouped = scan.results.reduce<Record<string, ScanResultItem[]>>((acc, r) => {
    const cat = r.category || 'autre'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(r)
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-5xl space-y-8" data-testid="scan-detail">
      <Link href="/scanner" className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="h-4 w-4" /> Nouveau scan
      </Link>

      {/* Hero compteur */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass relative overflow-hidden rounded-3xl border border-[var(--border)] p-8 lg:p-10"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--cyan)]/10 via-transparent to-[var(--purple)]/10" aria-hidden />
        <div className="relative">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Argent récupérable annuel
          </p>
          <div className="font-[family-name:var(--font-display)] text-5xl font-bold text-[var(--text-primary)] lg:text-7xl">
            <AnimatedCounter value={Number(scan.total_recoverable)} suffix=" €" />
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            soit <strong>{formatEuros(Number(scan.total_recoverable_monthly))}/mois</strong> · {scan.results.length} aides détectées
          </p>
          {scan.ai_summary && (
            <p className="mt-4 max-w-2xl rounded-xl border border-[var(--border)] bg-white/5 p-4 text-sm text-[var(--text-secondary)]">
              💡 {scan.ai_summary}
            </p>
          )}
          <div className="mt-6">
            <ShareStoryButton
              type="scan"
              headline="Voilà ce que je laissais sur la table"
              value={`+${formatEuros(Number(scan.total_recoverable))}`}
              sub={`${scan.results.length} aides détectées en 30 secondes`}
              variant="primary"
            />
          </div>
        </div>
      </motion.section>

      {/* Résultats par catégorie */}
      {Object.entries(grouped).map(([cat, items]) => {
        const catInfo = AIDE_CATEGORIES.find((c) => c.id === cat)
        return (
          <section key={cat}>
            <h2 className="mb-3 flex items-center gap-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
              <span>{catInfo?.icon ?? '📌'}</span>
              <span>{catInfo?.name ?? cat}</span>
              <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">{items.length} aide{items.length > 1 ? 's' : ''}</span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((item, i) => (
                <Card key={`${item.aide}-${i}`} className="p-5">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-[var(--text-primary)]">{item.aide}</h3>
                    <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-400">
                      {formatEuros(item.montant_estime)}
                      <span className="opacity-60">/{item.unite}</span>
                    </span>
                  </div>
                  <p className="mb-3 text-xs text-[var(--text-muted)]">
                    <em>{item.organisme}</em> · {item.eligibilite}
                  </p>
                  {item.conditions.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {item.conditions.slice(0, 3).map((c, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => launchDemarche(item)}
                      disabled={launching === item.aide}
                    >
                      {launching === item.aide ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      Lancer la démarche
                    </Button>
                    {item.lien_officiel && (
                      <a
                        href={item.lien_officiel}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white/5 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-white/10"
                      >
                        Site officiel <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
