import { z } from 'zod'
import type { Situation } from '@/types'

export interface ScanIntent {
  authUserId: string
  profileId: string
  id: string
  type: 'financial' | 'fiscal' | 'forgotten_money'
  input: Situation
}

const ScanStateSchema = z.object({
  id: z.uuid(), user_id: z.uuid(),
  type: z.enum(['financial', 'fiscal', 'forgotten_money']),
  input_data: z.record(z.string(), z.unknown()),
  status: z.enum(['processing', 'completed', 'failed']),
  processing_expires_at: z.iso.datetime({ offset: true }).nullable(),
  failure_code: z.enum(['provider_unavailable', 'provider_timeout', 'invalid_model_result', 'result_unconfirmed']).nullable(),
}).passthrough()

export const ScanMutationSchema = z.object({
  version: z.literal(1),
  outcome: z.enum(['reserved', 'completed', 'in_progress', 'failed', 'quota_exceeded',
    'conflict', 'profile_missing', 'not_found', 'legacy_unconfirmed']),
  plan: z.enum(['free', 'premium']).optional(),
  limit: z.literal(5).optional(), used: z.number().int().nonnegative().safe().optional(),
  changed: z.boolean().optional(), scan: ScanStateSchema.optional(),
})

// JSONB compares objects structurally, independently of member order. Request
// situations contain only JSON values; no serialized-key-order comparison.
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]))
  }
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
}

export function matchesScanIntent(scan: z.infer<typeof ScanStateSchema> | undefined, intent: ScanIntent): boolean {
  return !!scan && scan.id === intent.id && scan.user_id === intent.profileId
    && scan.type === intent.type && sameJson(scan.input_data, intent.input)
}

export function scanRpcArguments(intent: ScanIntent) {
  return { p_auth_user_id: intent.authUserId, p_request_id: intent.id, p_type: intent.type, p_input_data: intent.input }
}
