/**
 * GET /api/legal/my-data — export complet des données personnelles au format JSON
 * (droit à la portabilité, art. 20 RGPD ; page « Ma mémoire »).
 *
 * ADAPTATION SCHÉMA (cette app ne suit PAS la convention écosystème "profiles.id =
 * auth.users.id" — vida_aide.profiles a son propre id, lié via auth_user_id, cf schema.sql
 * L17-19) : on résout d'abord profile.id depuis auth_user_id, puis EXTRA_TABLES est filtré
 * sur profile.id (toutes les tables métier référencent profiles.id, pas auth.users.id).
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

const EXTRA_TABLES: Array<{ table: string; userIdColumn: string }> = [
  { table: 'scans', userIdColumn: 'user_id' },
  { table: 'demarches', userIdColumn: 'user_id' },
  { table: 'conversations', userIdColumn: 'user_id' },
  { table: 'messages', userIdColumn: 'user_id' },
  { table: 'mission_completions', userIdColumn: 'user_id' },
  { table: 'contest_entries', userIdColumn: 'user_id' },
  { table: 'wallet_transactions', userIdColumn: 'user_id' },
  { table: 'withdrawals', userIdColumn: 'user_id' },
  { table: 'payments', userIdColumn: 'user_id' },
  { table: 'notifications', userIdColumn: 'user_id' },
]

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('*').eq('auth_user_id', user.id).maybeSingle()

  const [{ data: acceptances }, { data: cookieConsent }] = await Promise.all([
    supabase.from('legal_acceptances').select('doc_type, version, accepted_at').eq('user_id', user.id),
    supabase.from('cookie_consents').select('*').eq('user_id', user.id).maybeSingle(),
  ])

  const extra: Record<string, unknown> = {}
  if (profile) {
    for (const { table, userIdColumn } of EXTRA_TABLES) {
      const { data } = await supabase.from(table).select('*').eq(userIdColumn, profile.id)
      extra[table] = data ?? []
    }

    const { data: referrals } = await supabase
      .from('referrals')
      .select('*')
      .or(`referrer_id.eq.${profile.id},referred_id.eq.${profile.id}`)
    extra.referrals = referrals ?? []
  }

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    compte: { id: user.id, email: user.email, createdAt: user.created_at },
    profile: profile ?? null,
    acceptationsLegales: acceptances ?? [],
    consentementCookies: cookieConsent ?? null,
    ...extra,
  }

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="mes-donnees.json"',
    },
  })
}
