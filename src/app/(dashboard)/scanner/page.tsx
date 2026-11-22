'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, Sparkles, Coins, Building2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useScanRequest } from '@/hooks/useScanRequest'
import { scanContent, type ScanPayload } from '@/lib/scan-attempt'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { CORRIDORS_FRONTALIERS } from '@/lib/constants'
import type { Profile, Situation } from '@/types'

const SCAN_TYPES = [
  { id: 'financial', label: 'Scanner financier', desc: 'Des pistes d’aides sociales à vérifier', icon: Search, accent: 'cyan' },
  { id: 'fiscal', label: 'Optimisation fiscale', desc: 'Crédits d\'impôt, déductions, frontaliers', icon: Coins, accent: 'purple' },
  { id: 'forgotten_money', label: 'Argent oublié', desc: 'Ciclade, assurances vie, trop-perçus', icon: Building2, accent: 'green' },
] as const

type ScanType = typeof SCAN_TYPES[number]['id']

export default function ScannerPage() {
  const { user, profile, loading, refetch } = useAuth()
  if (loading || !user || !profile || profile.auth_user_id !== user.id) {
    return <Card className="mx-auto max-w-xl p-6 text-center" role="status">Vérification du compte et de son profil…</Card>
  }
  return <ScannerForm key={`${user.id}:${profile.id}`} profile={profile} refetch={refetch} />
}

function ScannerForm({ profile, refetch }: { profile: Profile; refetch: ReturnType<typeof useAuth>['refetch'] }) {
  const router = useRouter()
  const [scanType, setScanType] = useState<ScanType>('financial')
  const [situation, setSituation] = useState<Situation>(() => (profile?.situation as Situation) ?? {})
  const { loading, ready, error, attempt, restored, run, reset } = useScanRequest(profile?.id)
  const [appliedRestore, setAppliedRestore] = useState<ScanPayload | null>(null)
  useEffect(() => {
    if (restored) { setSituation(restored.situation); setScanType(restored.type); setAppliedRestore(restored) }
  }, [restored])
  const formReady = ready && (!restored || appliedRestore === restored)
  const sameContent = attempt?.content === scanContent({ type: scanType, situation })

  function update<K extends keyof Situation>(k: K, v: Situation[K]) {
    setSituation((prev) => ({ ...prev, [k]: v }))
  }

  async function launchScan() {
    if (!profile || !formReady) return
    if (!situation.age || !situation.emploi) {
      toast.error('Renseigne au minimum ton âge et ta situation pro.')
      return
    }
    const data = await run({ type: scanType, situation })
    if (data) {
      toast.success(`Estimation enregistrée : ${data.count} pistes d’aides à vérifier.`)
      refetch()
      router.push(`/scanner/${data.scanId}`)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8" data-testid="scanner-page">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold text-[var(--text-primary)]">Scanner financier</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          AideIA propose des estimations indicatives et des pistes à vérifier auprès des organismes. Un scan ne prouve ni un droit acquis, ni un versement.
        </p>
      </header>

      {/* Type de scan */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Type de scan</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {SCAN_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={loading || !formReady}
              onClick={() => setScanType(t.id)}
              data-testid={`scan-type-${t.id}`}
              className={`glass relative rounded-2xl border p-5 text-left transition-all ${
                scanType === t.id
                  ? 'border-[var(--cyan)] bg-[var(--cyan)]/5 ring-2 ring-[var(--cyan)]/40'
                  : 'border-[var(--border)] hover:border-white/15 hover:bg-white/[0.03]'
              }`}
            >
              <t.icon className="mb-2 h-6 w-6 text-[var(--cyan)]" />
              <div className="font-semibold text-[var(--text-primary)]">{t.label}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">{t.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Formulaire situation */}
      <Card className="p-6">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">Ta situation</h2>
        <fieldset disabled={loading || !formReady}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Âge">
            <Input
              type="number"
              value={situation.age ?? ''}
              onChange={(e) => update('age', e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Ex : 32"
              data-testid="field-age"
            />
          </Field>

          <Field label="Situation pro">
            <Select
              value={situation.emploi ?? ''}
              onChange={(v) => update('emploi', v as Situation['emploi'])}
              data-testid="field-emploi"
              options={[
                { value: '', label: '— Choisir —' },
                { value: 'salarie', label: 'Salarié' },
                { value: 'cadre', label: 'Cadre' },
                { value: 'independant', label: 'Indépendant' },
                { value: 'fonctionnaire', label: 'Fonctionnaire' },
                { value: 'frontalier', label: 'Frontalier' },
                { value: 'chomeur', label: 'Demandeur d\'emploi' },
                { value: 'etudiant', label: 'Étudiant' },
                { value: 'retraite', label: 'Retraité' },
                { value: 'sans_emploi', label: 'Sans activité' },
              ]}
            />
          </Field>

          {situation.emploi === 'frontalier' && (
            <Field label="Pays frontalier">
              <Select
                value={situation.pays_frontalier ?? ''}
                onChange={(v) => update('pays_frontalier', (v || null) as Situation['pays_frontalier'])}
                options={[
                  { value: '', label: '— Choisir —' },
                  ...CORRIDORS_FRONTALIERS.map((c) => ({ value: c.id, label: `${c.flag} ${c.name}` })),
                ]}
              />
            </Field>
          )}

          <Field label="Revenus mensuels nets (€)">
            <Input
              type="number"
              value={situation.revenus_mensuels_nets ?? ''}
              onChange={(e) => update('revenus_mensuels_nets', e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Ex : 1800"
              data-testid="field-revenus"
            />
          </Field>

          <Field label="Logement">
            <Select
              value={situation.logement ?? ''}
              onChange={(v) => update('logement', v as Situation['logement'])}
              options={[
                { value: '', label: '— Choisir —' },
                { value: 'locataire', label: 'Locataire' },
                { value: 'proprietaire', label: 'Propriétaire' },
                { value: 'heberge', label: 'Hébergé' },
                { value: 'sans_domicile', label: 'Sans domicile fixe' },
              ]}
            />
          </Field>

          {situation.logement === 'locataire' && (
            <Field label="Loyer mensuel (€)">
              <Input
                type="number"
                value={situation.loyer_mensuel ?? ''}
                onChange={(e) => update('loyer_mensuel', e.target.value ? Number(e.target.value) : undefined)}
                placeholder="Ex : 600"
              />
            </Field>
          )}

          <Field label="Situation familiale">
            <Select
              value={situation.famille ?? ''}
              onChange={(v) => update('famille', v as Situation['famille'])}
              options={[
                { value: '', label: '— Choisir —' },
                { value: 'celibataire', label: 'Célibataire' },
                { value: 'couple', label: 'En couple' },
                { value: 'pacs', label: 'Pacsé(e)' },
                { value: 'marie', label: 'Marié(e)' },
                { value: 'divorce', label: 'Divorcé(e)' },
                { value: 'veuf', label: 'Veuf(ve)' },
              ]}
            />
          </Field>

          <Field label="Enfants à charge">
            <Input
              type="number"
              value={situation.enfants_a_charge ?? ''}
              onChange={(e) => update('enfants_a_charge', e.target.value ? Number(e.target.value) : undefined)}
              placeholder="0"
            />
          </Field>

          <Field label="Région">
            <Input
              value={situation.region ?? ''}
              onChange={(e) => update('region', e.target.value)}
              placeholder="Ex : Bourgogne-Franche-Comté"
            />
          </Field>

          <Field label="Handicap reconnu">
            <Select
              value={situation.handicap ? 'oui' : 'non'}
              onChange={(v) => update('handicap', v === 'oui')}
              options={[
                { value: 'non', label: 'Non' },
                { value: 'oui', label: 'Oui' },
              ]}
            />
          </Field>
        </div>
        </fieldset>

        <div className="mt-6 flex items-start gap-2 rounded-xl bg-[var(--cyan)]/5 p-3 text-xs text-[var(--text-secondary)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cyan)]" />
          <span>Ces informations servent à préparer une estimation, dont les conditions doivent être vérifiées. La demande en cours reste conservée dans cet onglet pour permettre sa reprise.</span>
        </div>

        <p className="mt-3 text-xs text-[var(--text-muted)]">En gratuit, chaque nouvelle demande, même échouée ou incertaine, compte dans la limite de 5 scans par 24 h. Reprendre la même demande ne relance pas le modèle. Modifier le contenu crée une nouvelle demande. Ce décompte ne déclenche aucun paiement.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        {!formReady && !error && <p role="status" className="mt-3 text-sm text-[var(--text-muted)]">Lecture de la demande conservée…</p>}
        {(attempt || !ready) && <Button variant="secondary" disabled={loading || !profile} onClick={reset} data-testid="btn-new-scan-intent" className="mt-3">Préparer une nouvelle demande</Button>}

        <Button
          onClick={launchScan}
          disabled={loading || !formReady}
          className="mt-6 w-full"
          data-testid="btn-launch-scan"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Scan en cours…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {sameContent ? 'Reprendre cette demande' : 'Lancer un nouveau scan'}
            </>
          )}
        </Button>
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  )
}

function Select({
  value,
  onChange,
  options,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  'data-testid'?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-[var(--border)] bg-white/5 px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--cyan)] focus:outline-none focus:ring-2 focus:ring-[var(--cyan)]/20"
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#0A0A0F]">
          {o.label}
        </option>
      ))}
    </select>
  )
}
