import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

const AideSchema = z.object({
  aide: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  organisme: z.string().min(1).max(200),
  montant_estime: z.number().min(0),
})

const BodySchema = z.object({
  scan_id: z.string().uuid(),
  aide: AideSchema,
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
    .select('id, total_demarches_launched, purama_points')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Profil introuvable.' }, { status: 404 })

  const { aide } = parsed.data

  // Idempotent: don't recreate if already exists
  const { data: existing } = await admin
    .from('demarches')
    .select('id')
    .eq('user_id', profile.id)
    .eq('scan_id', parsed.data.scan_id)
    .eq('aide_name', aide.aide)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, demarche_id: existing.id, already: true })
  }

  const { data: demarche, error } = await admin
    .from('demarches')
    .insert({
      user_id: profile.id,
      scan_id: parsed.data.scan_id,
      aide_name: aide.aide,
      category: aide.category,
      organisme: aide.organisme,
      montant_estime: aide.montant_estime,
      status: 'preparing',
    })
    .select('id, status')
    .single()

  if (error || !demarche) {
    return NextResponse.json({ error: 'Impossible de créer la démarche.' }, { status: 500 })
  }

  await admin
    .from('profiles')
    .update({
      total_demarches_launched: (profile.total_demarches_launched ?? 0) + 1,
      purama_points: (profile.purama_points ?? 0) + 200,
    })
    .eq('id', profile.id)

  await admin.from('notifications').insert({
    user_id: profile.id,
    type: 'demarche',
    title: '🚀 Démarche lancée',
    body: `${aide.aide} (${aide.organisme}) — ton dossier est en cours de préparation.`,
    icon: '📋',
    action_url: '/dashboard/missions',
  })

  return NextResponse.json({ ok: true, demarche_id: demarche.id })
}
