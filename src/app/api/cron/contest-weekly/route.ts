import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Existing distribution, including the undistributed remainder when fewer than
// ten winners qualify. Calculate cents with integer thousandths, not floats.
const PRIZE_DISTRIBUTION = [330, 170, 120, 80, 70, 50, 45, 45, 45, 45]
const prizeCents = (pool: number, index: number) => Math.floor(pool * PRIZE_DISTRIBUTION[index] / 1000)
const moneyCents = z.number().int().min(0).max(2_147_483_647)
const ContestSchema = z.object({
  id: z.uuid(), title: z.string(), type: z.literal('weekly'),
  total_pool_cents: moneyCents, end_date: z.iso.datetime({ offset: true }), status: z.literal('live'),
})
const ProfileSchema = z.object({
  id: z.uuid(), full_name: z.string().nullable(),
  streak_days: z.number().int().nullable(), level: z.number().int().nullable(),
})
const WinnerSchema = z.object({
  rank: z.number().int().min(1).max(10), user_id: z.uuid(), name: z.string().nullable(),
  score: z.number().int().positive().safe(), amount_cents: moneyCents,
})
const ReceiptSchema = z.object({
  version: z.literal(1), contest_id: z.uuid(), duplicate: z.boolean(),
  winners_count: z.number().int().min(0).max(10), total_paid_cents: moneyCents,
  awards: z.array(WinnerSchema).max(10),
})

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Accès refusé. Cette route est réservée au planificateur.' }, { status: 401 })
  }
  const results: Array<{ contest_id: string; winners_count: number; total_paid_cents: number; duplicate: boolean }> = []
  const failed: Array<{ contest_id: string; code: 'contest_settlement_unconfirmed' }> = []
  const nowIso = new Date().toISOString()
  try {
    const supabase = createServiceClient()
    const { data: rawContests, error: contestsError } = await supabase.from('contests')
      .select('id,title,type,total_pool_cents,end_date,status')
      .eq('type', 'weekly').eq('status', 'live').lte('end_date', nowIso)
    if (contestsError) throw new Error('Contest read failed')
    const contests = z.array(ContestSchema).parse(rawContests)
    for (const contest of contests) {
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
        const { data: rawProfiles, error: profilesError } = await supabase.from('profiles')
          .select('id,full_name,total_demarches_launched,streak_days,level')
          .gte('updated_at', sevenDaysAgo).order('total_demarches_launched', { ascending: false }).limit(500)
        if (profilesError) throw new Error('Candidate read failed')
        const profiles = z.array(ProfileSchema).max(500).parse(rawProfiles)
        if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('Repeated candidate')
        const userIds = profiles.map((profile) => profile.id)
        const refCount = new Map<string, number>()
        const missionCount = new Map<string, number>()
        const scanCount = new Map<string, number>()
        if (profiles.length) {
          const [referrals, missions, scans] = await Promise.all([
            supabase.from('referrals').select('referrer_id').in('referrer_id', userIds).gte('created_at', sevenDaysAgo),
            supabase.from('mission_completions').select('user_id').in('user_id', userIds).gte('created_at', sevenDaysAgo),
            supabase.from('scans').select('user_id').in('user_id', userIds).eq('status', 'completed').gte('created_at', sevenDaysAgo),
          ])
          if (referrals.error || missions.error || scans.error) throw new Error('Activity read failed')
          for (const row of z.array(z.object({ referrer_id: z.uuid() })).parse(referrals.data)) {
            if (!userIds.includes(row.referrer_id)) throw new Error('Foreign activity')
            refCount.set(row.referrer_id, (refCount.get(row.referrer_id) ?? 0) + 1)
          }
          for (const [response, counts] of [[missions, missionCount], [scans, scanCount]] as const) {
            for (const row of z.array(z.object({ user_id: z.uuid() })).parse(response.data)) {
              if (!userIds.includes(row.user_id)) throw new Error('Foreign activity')
              counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1)
            }
          }
        }
        const scored = profiles.map((profile) => ({
          user_id: profile.id, name: profile.full_name,
          score: (refCount.get(profile.id) ?? 0) * 10 + (missionCount.get(profile.id) ?? 0) * 3
            + (scanCount.get(profile.id) ?? 0) * 2 + (profile.streak_days ?? 0) + (profile.level ?? 1),
        }))
        scored.sort((a, b) => b.score - a.score)
        const winners = z.array(WinnerSchema).parse(scored.slice(0, 10).filter((winner) => winner.score > 0)
          .map((winner, index) => ({
            ...winner, rank: index + 1,
            amount_cents: prizeCents(contest.total_pool_cents, index),
          })))
        // No balance/notification/closure is written outside this transaction.
        const { data, error } = await supabase.rpc('settle_weekly_contest_v1', {
          p_contest_id: contest.id, p_expected_pool: contest.total_pool_cents,
          p_expected_end: contest.end_date, p_winners: winners,
        })
        if (error) throw new Error('Contest settlement failed')
        const receipt = ReceiptSchema.parse(data)
        if (receipt.contest_id !== contest.id || receipt.winners_count !== receipt.awards.length
          || new Set(receipt.awards.map((award) => award.user_id)).size !== receipt.awards.length
          || receipt.awards.some((award, index) => award.rank !== index + 1)
          || receipt.awards.some((award, index) => award.amount_cents !== prizeCents(contest.total_pool_cents, index))
          || receipt.total_paid_cents !== receipt.awards.reduce((sum, award) => sum + award.amount_cents, 0)
          || receipt.total_paid_cents > contest.total_pool_cents
          || (!receipt.duplicate && JSON.stringify(receipt.awards) !== JSON.stringify(winners))) {
          throw new Error('Contest receipt mismatch')
        }
        results.push({ contest_id: receipt.contest_id, winners_count: receipt.winners_count,
          total_paid_cents: receipt.total_paid_cents, duplicate: receipt.duplicate })
      } catch {
        // One unresolved historical contest must not stop other independent ones.
        failed.push({ contest_id: contest.id, code: 'contest_settlement_unconfirmed' })
      }
    }
    return NextResponse.json({ ok: failed.length === 0, processed: results.length, results,
      ...(failed.length ? { failed } : {}), timestamp: nowIso }, { status: failed.length ? 500 : 200 })
  } catch {
    return NextResponse.json({ ok: false, error: 'La lecture ou le règlement des concours ne peut pas être confirmé.' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return POST(request)
}
