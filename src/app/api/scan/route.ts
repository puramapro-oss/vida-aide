import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { scanFinancialJSON } from '@/lib/claude'
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
  type: z.enum(['financial', 'fiscal', 'forgotten_money']),
  situation: SituationSchema,
})

export async function POST(req: Request) {
  const sb = await createServerSupabaseClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 })

  const json = await req.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Données invalides.' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, subscription_plan, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Profil introuvable.' }, { status: 404 })

  const plan: Plan = profile.role === 'super_admin' ? 'premium' : (profile.subscription_plan as Plan)

  let result
  try {
    result = await scanFinancialJSON(parsed.data.situation, parsed.data.type, plan)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Scan IA en erreur'
    return NextResponse.json({ error: 'AideIA est indisponible un instant. Réessaie. (' + msg + ')' }, { status: 502 })
  }

  // Persist scan
  const { data: scan, error: insertErr } = await admin
    .from('scans')
    .insert({
      user_id: profile.id,
      type: parsed.data.type,
      input_data: parsed.data.situation,
      results: result.results,
      total_recoverable: result.total_recoverable,
      total_recoverable_monthly: result.total_recoverable_monthly,
      ai_summary: result.summary,
      status: 'completed',
    })
    .select('id, total_recoverable, total_recoverable_monthly, ai_summary, results')
    .single()

  if (insertErr || !scan) {
    return NextResponse.json({ error: 'Impossible de sauvegarder le scan.' }, { status: 500 })
  }

  // Persist situation on profile if not set
  await admin
    .from('profiles')
    .update({
      situation: parsed.data.situation,
      total_money_recovered: result.total_recoverable,
      onboarded: true,
      xp: 100,
    })
    .eq('id', profile.id)

  // Award points for first scan
  await admin.from('notifications').insert({
    user_id: profile.id,
    type: 'scan',
    title: '🎉 Scan terminé',
    body: `${result.results.length} aides détectées · ${Number(result.total_recoverable).toFixed(0)} € récupérables.`,
    icon: '💰',
    action_url: `/scanner/${scan.id}`,
  })

  return NextResponse.json({
    ok: true,
    scan_id: scan.id,
    results: result.results,
    total_recoverable: result.total_recoverable,
    total_recoverable_monthly: result.total_recoverable_monthly,
    summary: result.summary,
  })
}
