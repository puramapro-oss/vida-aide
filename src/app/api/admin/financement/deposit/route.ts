import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'

const DepositSchema = z.object({
  type: z.enum(['aide_sasu', 'aide_asso', 'partner_deposit', 'adjustment']),
  amount_euros: z.number().positive().max(10_000_000),
  source_name: z.string().min(2).max(200),
  description: z.string().max(500).optional(),
})

const POOL_BY_TYPE: Record<string, 'reward' | 'asso' | 'partner'> = {
  aide_sasu: 'reward',
  aide_asso: 'asso',
  partner_deposit: 'partner',
  adjustment: 'reward',
}

const REASON_BY_TYPE: Record<string, 'aide_deposit' | 'partner_deposit' | 'adjustment'> = {
  aide_sasu: 'aide_deposit',
  aide_asso: 'aide_deposit',
  partner_deposit: 'partner_deposit',
  adjustment: 'adjustment',
}

export async function POST(req: Request) {
  const sb = await createServerSupabaseClient()
  const {
    data: { user },
  } = await sb.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Connexion requise.' }, { status: 401 })
  }

  const admin = createServiceClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!profile || profile.role !== 'super_admin') {
    return NextResponse.json(
      { error: 'Accès réservé aux super-admins.' },
      { status: 403 },
    )
  }

  const json = await req.json().catch(() => ({}))
  const parsed = DepositSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Données invalides.' },
      { status: 400 },
    )
  }

  const { type, amount_euros, source_name, description } = parsed.data
  const amount_cents = Math.round(amount_euros * 100)
  const pool_type = POOL_BY_TYPE[type]
  const reason = REASON_BY_TYPE[type]

  // 1. Insert funding source (audit trail)
  const { data: source, error: srcErr } = await admin
    .from('funding_sources')
    .insert({
      type,
      amount_cents,
      source_name,
      description,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (srcErr || !source) {
    return NextResponse.json(
      { error: "Impossible d'enregistrer la source de financement." },
      { status: 500 },
    )
  }

  // 2. Insert pool transaction (trigger updates pool_balances)
  const { error: txErr } = await admin.from('pool_transactions').insert({
    pool_type,
    amount_cents,
    direction: 'in',
    reason,
    source_id: source.id,
    description: `${source_name}${description ? ' — ' + description : ''}`,
    created_by: profile.id,
  })

  if (txErr) {
    return NextResponse.json(
      { error: 'Source enregistrée mais crédit du pool a échoué.' },
      { status: 500 },
    )
  }

  // 3. Return fresh balance
  const { data: balance } = await admin
    .from('pool_balances')
    .select('pool_type, balance_cents, total_in_cents, total_out_cents')
    .eq('pool_type', pool_type)
    .single()

  return NextResponse.json({
    ok: true,
    source_id: source.id,
    pool_type,
    balance,
  })
}
