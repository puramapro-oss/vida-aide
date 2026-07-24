'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Coins,
  Heart,
  Handshake,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Plus,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { formatEurosFraction } from '@/lib/utils'

type PoolType = 'reward' | 'asso' | 'partner'

type PoolBalance = {
  pool_type: PoolType
  balance_cents: number
  total_in_cents: number
  total_out_cents: number
  updated_at: string
}

type PoolTransaction = {
  id: string
  pool_type: PoolType
  amount_cents: number
  direction: 'in' | 'out'
  reason: string
  description: string | null
  created_at: string
}

type FundingSource = {
  id: string
  type: string
  amount_cents: number
  source_name: string
  description: string | null
  created_at: string
}

type DepositType = 'aide_sasu' | 'aide_asso' | 'partner_deposit' | 'adjustment'

const POOL_META: Record<
  PoolType,
  { label: string; subtitle: string; color: string; bg: string; icon: typeof Coins }
> = {
  reward: {
    label: 'Reward pool',
    subtitle: 'Classement hebdo + tirage mensuel users',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.12)',
    icon: Coins,
  },
  asso: {
    label: 'Asso pool',
    subtitle: 'Asso PURAMA (Solenne) — transfert IBAN',
    color: '#F472B6',
    bg: 'rgba(244,114,182,0.12)',
    icon: Heart,
  },
  partner: {
    label: 'Partner pool',
    subtitle: '15 % dépôts entreprises / sponsors',
    color: '#0EA5E9',
    bg: 'rgba(14,165,233,0.12)',
    icon: Handshake,
  },
}

const DEPOSIT_OPTIONS: Array<{ value: DepositType; label: string; pool: PoolType }> = [
  { value: 'aide_sasu', label: 'Aide SASU → Reward', pool: 'reward' },
  { value: 'aide_asso', label: 'Aide Asso → Asso', pool: 'asso' },
  { value: 'partner_deposit', label: 'Dépôt partenaire → Partner', pool: 'partner' },
  { value: 'adjustment', label: 'Ajustement → Reward', pool: 'reward' },
]

const REASON_LABELS: Record<string, string> = {
  ca_10pct: '10 % CA Stripe',
  aide_deposit: 'Aide déposée',
  partner_deposit: 'Partenaire',
  contest_payout: 'Classement hebdo',
  tirage_payout: 'Tirage mensuel',
  mission_payout: 'Mission',
  asso_transfer: 'Transfert Asso',
  adjustment: 'Ajustement',
}

export default function FinancementPage() {
  const router = useRouter()
  const { isSuperAdmin, loading: authLoading } = useAuth()
  const [balances, setBalances] = useState<PoolBalance[]>([])
  const [transactions, setTransactions] = useState<PoolTransaction[]>([])
  const [sources, setSources] = useState<FundingSource[]>([])
  const [loading, setLoading] = useState(true)

  // Deposit form
  const [depositType, setDepositType] = useState<DepositType>('aide_sasu')
  const [amount, setAmount] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!isSuperAdmin) {
      router.replace('/dashboard')
      return
    }
    loadData()
     
  }, [authLoading, isSuperAdmin, router])

  async function loadData() {
    setLoading(true)
    const sb = createClient()
    const [balRes, txRes, srcRes] = await Promise.all([
      sb.from('pool_balances').select('*').order('pool_type'),
      sb
        .from('pool_transactions')
        .select('id, pool_type, amount_cents, direction, reason, description, created_at')
        .order('created_at', { ascending: false })
        .limit(20),
      sb
        .from('funding_sources')
        .select('id, type, amount_cents, source_name, description, created_at')
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    setBalances((balRes.data as PoolBalance[]) ?? [])
    setTransactions((txRes.data as PoolTransaction[]) ?? [])
    setSources((srcRes.data as FundingSource[]) ?? [])
    setLoading(false)
  }

  async function submit() {
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0) {
      toast.error('Montant invalide. Ex : 150.00')
      return
    }
    if (sourceName.trim().length < 2) {
      toast.error('Nom de la source requis (ex : « CPF 2026 », « Région BFC »).')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/financement/deposit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: depositType,
          amount_euros: amountNum,
          source_name: sourceName.trim(),
          description: description.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      toast.success(
        `+${amountNum.toFixed(2)} € → ${data.pool_type} pool`,
      )
      setAmount('')
      setSourceName('')
      setDescription('')
      await loadData()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (!isSuperAdmin) return null

  const totalPools = balances.reduce((s, b) => s + b.balance_cents, 0) / 100
  const totalIn = balances.reduce((s, b) => s + b.total_in_cents, 0) / 100
  const totalOut = balances.reduce((s, b) => s + b.total_out_cents, 0) / 100

  return (
    <div className="mx-auto max-w-6xl space-y-6" data-testid="admin-financement-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/admin"
            className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3 w-3" /> Admin
          </Link>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)]">
            Financement
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Pools reward (users) · asso (Solenne) · partner (entreprises).
            Alimente avec subventions, aides, dépôts partenaires.
          </p>
        </div>
      </header>

      {/* Totals */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-[var(--text-muted)]">Total pools</p>
          <p
            className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]"
            data-testid="admin-fin-total"
          >
            {formatEurosFraction(totalPools)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-emerald-400">
            <TrendingUp className="h-3 w-3" />
            <span>Entrées cumulées</span>
          </div>
          <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            {formatEurosFraction(totalIn)}
          </p>
        </Card>
        <Card className="p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-orange-400">
            <TrendingDown className="h-3 w-3" />
            <span>Sorties cumulées</span>
          </div>
          <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
            {formatEurosFraction(totalOut)}
          </p>
        </Card>
      </div>

      {/* Pool cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {(['reward', 'asso', 'partner'] as PoolType[]).map((pool) => {
          const b = balances.find((x) => x.pool_type === pool)
          const meta = POOL_META[pool]
          const Icon = meta.icon
          return (
            <Card
              key={pool}
              className="p-5"
              data-testid={`admin-fin-pool-${pool}`}
            >
              <div className="mb-3 flex items-center gap-2">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: meta.bg }}
                >
                  <Icon className="h-5 w-5" style={{ color: meta.color }} />
                </div>
                <div>
                  <p
                    className="text-sm font-semibold text-[var(--text-primary)]"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {meta.subtitle}
                  </p>
                </div>
              </div>
              <p
                className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--text-primary)]"
                data-testid={`admin-fin-pool-${pool}-balance`}
              >
                {loading
                  ? '…'
                  : formatEurosFraction((b?.balance_cents ?? 0) / 100)}
              </p>
              <div className="mt-3 flex justify-between text-[10px] text-[var(--text-muted)]">
                <span>↑ {formatEurosFraction((b?.total_in_cents ?? 0) / 100)}</span>
                <span>↓ {formatEurosFraction((b?.total_out_cents ?? 0) / 100)}</span>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Deposit form */}
      <Card className="p-5" data-testid="admin-fin-deposit-card">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10">
            <Plus className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Nouvelle entrée
            </h2>
            <p className="text-[11px] text-[var(--text-muted)]">
              Aide publique, subvention, dépôt partenaire, ajustement
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
              Type
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEPOSIT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDepositType(opt.value)}
                  data-testid={`admin-fin-type-${opt.value}`}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs transition-all ${
                    depositType === opt.value
                      ? 'border-emerald-400 bg-emerald-500/10 text-[var(--text-primary)]'
                      : 'border-white/[0.08] bg-white/[0.02] text-[var(--text-muted)] hover:border-white/20'
                  }`}
                >
                  <span className="font-semibold">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Montant (€)"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="150.00"
              data-testid="admin-fin-amount"
            />
            <Input
              label="Nom de la source"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="Ex : CAF Doubs, Région BFC, FDGDON"
              maxLength={200}
              data-testid="admin-fin-source"
            />
          </div>

          <Input
            label="Description (optionnel)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contexte, référence, période concernée"
            maxLength={500}
            data-testid="admin-fin-description"
          />

          <Button
            onClick={submit}
            loading={submitting}
            disabled={submitting || !amount || !sourceName.trim()}
            data-testid="admin-fin-submit"
            className="w-full"
          >
            Enregistrer → {DEPOSIT_OPTIONS.find((o) => o.value === depositType)?.pool} pool
          </Button>
        </div>
      </Card>

      {/* Recent sources */}
      <Card className="p-5" data-testid="admin-fin-sources-card">
        <h2 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
          Sources récentes
        </h2>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Chargement…</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Aucune source enregistrée. Utilise le formulaire ci-dessus.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {sources.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-4 py-2.5"
                data-testid={`admin-fin-source-${s.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {s.source_name}
                  </p>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">
                    {s.type} ·{' '}
                    {new Date(s.created_at).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {s.description ? ' · ' + s.description : ''}
                  </p>
                </div>
                <p className="text-sm font-semibold text-emerald-400">
                  +{formatEurosFraction(s.amount_cents / 100)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent transactions */}
      <Card className="p-5" data-testid="admin-fin-tx-card">
        <h2 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
          Dernières transactions
        </h2>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Chargement…</p>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Aucun mouvement sur les pools.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {transactions.map((tx) => {
              const isIn = tx.direction === 'in'
              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                      {tx.pool_type}
                    </p>
                    <p className="truncate text-sm text-[var(--text-primary)]">
                      {REASON_LABELS[tx.reason] ?? tx.reason}
                      {tx.description ? ' · ' + tx.description : ''}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {new Date(tx.created_at).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <p
                    className={`text-sm font-semibold ${
                      isIn ? 'text-emerald-400' : 'text-orange-400'
                    }`}
                  >
                    {isIn ? '+' : '−'}
                    {formatEurosFraction(tx.amount_cents / 100)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
