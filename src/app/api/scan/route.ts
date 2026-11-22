import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { SCAN_DAILY_LIMIT_FREE } from '@/lib/constants'
import { ScanReceiptSchema, ScanResultSchema } from '@/lib/scan-result'
import { ScanMutationSchema, matchesScanIntent, scanRpcArguments, type ScanIntent } from '@/lib/scan-admission'
import { obtainScanEstimate, ScanProviderInterrupted } from '@/lib/scan-provider'
import type { Plan } from '@/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const SituationSchema = z
  .object({
    emploi: z.enum(['salarie', 'cadre', 'independant', 'fonctionnaire', 'chomeur', 'etudiant', 'retraite', 'sans_emploi', 'frontalier']).optional(),
    pays_frontalier: z.enum(['CH', 'LU', 'DE', 'BE', 'IT', 'ES', 'MC', 'AD']).nullable().optional(),
    revenus_mensuels_nets: z.number().min(0).max(1000000).optional(),
    revenus_annuels_bruts: z.number().min(0).max(10000000).optional(),
    logement: z.enum(['locataire', 'proprietaire', 'heberge', 'sans_domicile']).optional(),
    loyer_mensuel: z.number().min(0).max(50000).optional(),
    famille: z.enum(['celibataire', 'couple', 'pacs', 'marie', 'divorce', 'veuf']).optional(),
    enfants: z.number().int().min(0).max(20).optional(),
    enfants_a_charge: z.number().int().min(0).max(20).optional(),
    handicap: z.boolean().optional(),
    handicap_taux: z.number().int().min(0).max(100).optional(),
    region: z.string().max(80).optional(),
    age: z.number().int().min(16).max(120).optional(),
  })
  .partial()

const BodySchema = z.object({
  request_id: z.uuid().optional(),
  type: z.enum(['financial', 'fiscal', 'forgotten_money']),
  situation: SituationSchema,
})

const ProfileSchema = z.object({
  id: z.uuid(),
  auth_user_id: z.uuid(),
  subscription_plan: z.enum(['free', 'premium']),
  role: z.enum(['user', 'super_admin']),
})

function scanSaveUnconfirmed(id: string) {
  return NextResponse.json({
    error: 'La sauvegarde du scan n’a pas pu être confirmée. Consulte tes scans avant de relancer.',
    code: 'scan_save_unconfirmed', scan_id: id,
  }, { status: 500 })
}

function scanSuccess(scan: z.infer<typeof ScanReceiptSchema>, warnings: string[] = [], replayed = false) {
  return NextResponse.json({
    ok: true, scan_id: scan.id, results: scan.results,
    total_recoverable: scan.total_recoverable, total_recoverable_monthly: scan.total_recoverable_monthly,
    summary: scan.ai_summary, ...(warnings.length ? { warnings } : {}), ...(replayed ? { replayed: true } : {}),
  })
}

function attemptBlocked(id: string, pending: boolean) {
  return NextResponse.json({
    error: pending ? 'Ce scan est déjà en cours. Conserve cette demande pour consulter son résultat.'
      : 'Cet essai ne possède pas d’estimation confirmée et reste compté pendant 24 h. Aucun nouvel appel automatique n’est effectué.',
    code: pending ? 'scan_in_progress' : 'scan_attempt_failed', scan_id: id,
  }, { status: 409 })
}

export async function POST(req: Request) {
  // An explicit API token must be verified itself. Never fall back to a cookie
  // identity when the native client supplied an invalid Authorization header.
  const authorization = req.headers.get('authorization')
  const token = authorization?.match(/^Bearer[ \t]+([A-Za-z0-9\-._~+/]+=*)$/i)?.[1]
  if (authorization !== null && !token) {
    return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 })
  }
  let userId: string
  try {
    const sb = await createServerSupabaseClient()
    const { data, error } = token ? await sb.auth.getUser(token) : await sb.auth.getUser()
    const verifiedId = z.uuid().safeParse(data?.user?.id)
    if (error || !verifiedId.success) {
      return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 })
    }
    userId = verifiedId.data
  } catch {
    return NextResponse.json({ error: 'La connexion ne peut pas être vérifiée pour le moment.' }, { status: 503 })
  }

  const json = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' }, { status: 400 })
  }

  const admin = createServiceClient()
  let profile: z.infer<typeof ProfileSchema>
  try {
    const { data, error } = await admin
      .from('profiles')
      .select('id, auth_user_id, subscription_plan, role')
      .eq('auth_user_id', userId)
      .maybeSingle()
    if (error) throw new Error('Profile read unavailable')
    if (!data) return NextResponse.json({ error: 'Profil introuvable.' }, { status: 404 })
    const validated = ProfileSchema.safeParse(data)
    if (!validated.success || validated.data.auth_user_id !== userId) {
      throw new Error('Profile admission not confirmed')
    }
    profile = validated.data
  } catch {
    return NextResponse.json({ error: 'Le profil ne peut pas être vérifié pour le moment.' }, { status: 503 })
  }

  const intent: ScanIntent = {
    authUserId: userId, profileId: profile.id, id: parsed.data.request_id ?? randomUUID(),
    type: parsed.data.type, input: parsed.data.situation,
  }
  let plan: Plan
  // The SQL transaction, not an application-side count, owns admission. It
  // rechecks the locked profile, reserves the ID and returns the stored intent.
  try {
    const { data, error } = await admin
      .rpc('reserve_scan_v1', scanRpcArguments(intent))
    const parsedReservation = ScanMutationSchema.safeParse(data)
    if (error || !parsedReservation.success) throw new Error('Unconfirmed scan reservation')
    const reservation = parsedReservation.data
    if (reservation.outcome === 'conflict') {
      return NextResponse.json({ error: 'Cette demande ne correspond pas à ce scan.', code: 'scan_request_conflict' }, { status: 409 })
    }
    if (reservation.outcome === 'profile_missing') return NextResponse.json({ error: 'Profil introuvable.' }, { status: 404 })
    if (reservation.outcome === 'quota_exceeded' && reservation.limit === SCAN_DAILY_LIMIT_FREE
      && reservation.used !== undefined && reservation.used >= SCAN_DAILY_LIMIT_FREE) {
      return NextResponse.json({
        error: `${SCAN_DAILY_LIMIT_FREE} essais de scan par 24 h en gratuit : les essais en cours, échoués ou non confirmés restent comptés.`,
        code: 'scan_daily_limit', upgrade_url: '/pricing',
      }, { status: 429 })
    }
    if (!matchesScanIntent(reservation.scan, intent)) throw new Error('Reservation identity mismatch')
    if (reservation.outcome === 'completed') {
      const receipt = ScanReceiptSchema.safeParse(reservation.scan)
      return receipt.success ? scanSuccess(receipt.data, [], true) : scanSaveUnconfirmed(intent.id)
    }
    if (reservation.outcome === 'in_progress' && reservation.scan?.status === 'processing') return attemptBlocked(intent.id, true)
    if (reservation.outcome === 'failed' && reservation.scan?.status === 'failed') return attemptBlocked(intent.id, false)
    if (reservation.outcome !== 'reserved' || !reservation.plan || reservation.scan?.status !== 'processing'
      || reservation.scan.failure_code !== null || !reservation.scan.processing_expires_at
      || Date.parse(reservation.scan.processing_expires_at) <= Date.now()) throw new Error('Reservation not admitted')
    plan = reservation.plan
  } catch {
    return NextResponse.json({
      error: 'La réservation du scan n’a pas pu être confirmée. Conserve la même demande pour réessayer.',
      code: 'scan_reservation_unconfirmed', scan_id: intent.id,
    }, { status: 503 })
  }

  async function closeFailure(failureCode: string, code: string, status: number) {
    try {
      const { data, error } = await admin.rpc('finish_scan_v1', {
        ...scanRpcArguments(intent), p_result: null, p_failure_code: failureCode,
      })
      const reply = ScanMutationSchema.safeParse(data)
      if (error || !reply.success || !matchesScanIntent(reply.data.scan, intent)) return scanSaveUnconfirmed(intent.id)
      if (reply.data.outcome === 'completed') {
        const receipt = ScanReceiptSchema.safeParse(reply.data.scan)
        return receipt.success ? scanSuccess(receipt.data, [], true) : scanSaveUnconfirmed(intent.id)
      }
      if (reply.data.outcome !== 'failed' || reply.data.scan?.status !== 'failed') return scanSaveUnconfirmed(intent.id)
      return NextResponse.json({
        error: 'Cet essai n’a pas produit d’estimation confirmée et reste compté dans le quota de 24 h.', code, scan_id: intent.id,
      }, { status })
    } catch {
      return scanSaveUnconfirmed(intent.id)
    }
  }

  let raw: unknown
  try {
    raw = await obtainScanEstimate(intent, plan, req.signal)
  } catch (error) {
    if (error instanceof ScanProviderInterrupted) {
      return error.reason === 'timeout'
        ? closeFailure('provider_timeout', 'scan_provider_timeout', 504)
        : closeFailure('result_unconfirmed', 'scan_provider_interrupted', 499)
    }
    return closeFailure('provider_unavailable', 'scan_provider_unavailable', 502)
  }
  const result = ScanResultSchema.safeParse(raw)
  if (!result.success) return closeFailure('invalid_model_result', 'scan_result_invalid', 502)

  let scan: z.infer<typeof ScanReceiptSchema>
  try {
    const { data, error } = await admin.rpc('finish_scan_v1', {
      ...scanRpcArguments(intent), p_result: result.data, p_failure_code: null,
    })
    const reply = ScanMutationSchema.safeParse(data)
    if (error || !reply.success || !matchesScanIntent(reply.data.scan, intent)) return scanSaveUnconfirmed(intent.id)
    if (reply.data.outcome === 'failed' && reply.data.scan?.status === 'failed') return attemptBlocked(intent.id, false)
    const receipt = ScanReceiptSchema.safeParse(reply.data.scan)
    if (reply.data.outcome !== 'completed' || !receipt.success || typeof reply.data.changed !== 'boolean') {
      return scanSaveUnconfirmed(intent.id)
    }
    scan = receipt.data
    if (!reply.data.changed) return scanSuccess(scan, [], true)
  } catch {
    return scanSaveUnconfirmed(intent.id)
  }

  // An estimate is not a payment receipt. Preserve all historical money and
  // wallet columns; only the existing situation/onboarding bookkeeping remains.
  const warnings: string[] = []
  try {
    const { error } = await admin
      .from('profiles')
      .update({ situation: parsed.data.situation, onboarded: true })
      .eq('id', profile.id)
    if (error) warnings.push('profile_update_failed')
  } catch {
    warnings.push('profile_update_failed')
  }

  try {
    const { error } = await admin.from('notifications').insert({
      user_id: profile.id,
      type: 'scan',
      title: 'Scan enregistré',
      body: `${scan.results.length} pistes à vérifier · estimation indicative de ${scan.total_recoverable.toFixed(0)} €.`,
      icon: '💰',
      action_url: `/scanner/${scan.id}`,
    })
    if (error) warnings.push('notification_failed')
  } catch {
    warnings.push('notification_failed')
  }

  return scanSuccess(scan, warnings)
}
