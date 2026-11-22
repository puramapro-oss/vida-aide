import type { Situation } from '@/types'

export type ScanPayload = { type: 'financial' | 'fiscal' | 'forgotten_money'; situation: Situation }
export type ScanAttempt = { version: 1; owner: string; requestId: string; content: string }
export class ScanRequestError extends Error {}
const key = (owner: string) => `vida_aide_scan_v1_${owner}`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fields = ['emploi', 'pays_frontalier', 'revenus_mensuels_nets', 'revenus_annuels_bruts', 'logement', 'loyer_mensuel', 'famille', 'enfants', 'enfants_a_charge', 'handicap', 'handicap_taux', 'region', 'age']

export function scanContent(payload: ScanPayload): string {
  return JSON.stringify({ type: payload.type, situation: Object.fromEntries(Object.entries(payload.situation)
    .filter(([field, value]) => fields.includes(field) && value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) })
}

export function attemptPayload(attempt: ScanAttempt): ScanPayload {
  const value: unknown = JSON.parse(attempt.content)
  if (!value || typeof value !== 'object' || !('type' in value) || !('situation' in value)
    || typeof value.type !== 'string' || !['financial', 'fiscal', 'forgotten_money'].includes(value.type)
    || !value.situation || typeof value.situation !== 'object' || Array.isArray(value.situation)) throw new ScanRequestError('La demande conservée est illisible. Choisis explicitement une nouvelle demande.')
  for (const [field, entry] of Object.entries(value.situation)) {
    const valid = fields.includes(field) && (field === 'handicap' ? typeof entry === 'boolean'
      : ['emploi', 'pays_frontalier', 'logement', 'famille', 'region'].includes(field)
        ? typeof entry === 'string' || (field === 'pays_frontalier' && entry === null)
        : typeof entry === 'number' && Number.isFinite(entry))
    if (!valid) throw new ScanRequestError('La demande conservée est invalide. Choisis explicitement une nouvelle demande.')
  }
  return value as ScanPayload
}

export function loadAttempt(owner: string): ScanAttempt | null {
  const raw = window.sessionStorage.getItem(key(owner))
  if (!raw) return null
  const value = JSON.parse(raw) as Partial<ScanAttempt>
  if (value.version !== 1 || value.owner !== owner || typeof value.requestId !== 'string'
    || !uuidPattern.test(value.requestId) || typeof value.content !== 'string') throw new ScanRequestError('La demande conservée est invalide. Choisis explicitement une nouvelle demande.')
  attemptPayload(value as ScanAttempt)
  return value as ScanAttempt
}

export function saveAttempt(attempt: ScanAttempt): void {
  window.sessionStorage.setItem(key(attempt.owner), JSON.stringify(attempt))
}

export function clearAttempt(owner: string): void {
  window.sessionStorage.removeItem(key(owner))
}

export function newAttempt(owner: string, content: string): ScanAttempt {
  try {
    const requestId = globalThis.crypto.randomUUID()
    if (!uuidPattern.test(requestId)) throw new Error('Invalid UUID')
    return { version: 1, owner, requestId, content }
  } catch {
    throw new ScanRequestError('Impossible de créer un identifiant sûr pour la demande. Aucun scan n’a été lancé.')
  }
}
