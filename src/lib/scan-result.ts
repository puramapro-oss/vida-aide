import { z } from 'zod'

// These amounts describe candidates only. NUMERIC(12,2) is the existing scans
// storage limit; validating a result never establishes eligibility or recovery.
const EstimateSchema = z.number().nonnegative().max(9_999_999_999.99)
const TextSchema = z.string().trim().min(1)
const OfficialLinkSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'https:' || protocol === 'http:'
})

export const ScanResultItemSchema = z.object({
  aide: TextSchema,
  category: TextSchema,
  montant_estime: EstimateSchema,
  unite: z.enum(['an', 'mois', 'unique']),
  eligibilite: TextSchema,
  conditions: z.array(TextSchema),
  demarche: TextSchema,
  lien_officiel: OfficialLinkSchema.optional(),
  difficulte: z.enum(['facile', 'moyen', 'complexe']),
  delai_jours: z.number().int().nonnegative().optional(),
  organisme: TextSchema,
})

const EstimateTotalsSchema = z.object({
  results: z.array(ScanResultItemSchema),
  total_recoverable: EstimateSchema,
  total_recoverable_monthly: EstimateSchema,
})

// Round the decimal representation, not its binary floating-point product:
// 10.075 becomes 1,008 cents. Every candidate is rounded before annualisation.
function estimateCents(value: number): bigint {
  const [coefficient, exponent = '0'] = value.toString().split('e')
  const [whole, fraction = ''] = coefficient.split('.')
  const digits = BigInt(whole + fraction)
  const shift = 2 + Number(exponent) - fraction.length
  if (shift >= 0) return digits * BigInt(10) ** BigInt(shift)
  const divisor = BigInt(10) ** BigInt(-shift)
  return (digits + divisor / BigInt(2)) / divisor
}

function checkEstimateTotals(value: z.infer<typeof EstimateTotalsSchema>, context: z.RefinementCtx) {
  let annual = BigInt(0)
  let monthly = BigInt(0)
  for (const candidate of value.results) {
    const cents = estimateCents(candidate.montant_estime)
    if (candidate.unite === 'mois') {
      monthly += cents
      annual += cents * BigInt(12)
    } else {
      annual += cents
    }
  }
  // A maximum one-cent difference is accepted for each declared aggregate.
  // This proves arithmetic only, never legal eligibility or cumulation rights.
  for (const [field, expected] of [
    ['total_recoverable', annual], ['total_recoverable_monthly', monthly],
  ] as const) {
    const difference = estimateCents(value[field]) - expected
    if (difference < BigInt(-1) || difference > BigInt(1)) {
      context.addIssue({ code: 'custom', path: [field], message: 'Le total ne correspond pas aux estimations et à leurs périodes.' })
    }
  }
}

export const ScanResultSchema = EstimateTotalsSchema.extend({
  summary: TextSchema,
}).superRefine(checkEstimateTotals)

export const ScanReceiptSchema = EstimateTotalsSchema.extend({
  id: z.uuid(),
  user_id: z.uuid(),
  type: z.enum(['financial', 'fiscal', 'forgotten_money']),
  input_data: z.record(z.string(), z.unknown()),
  status: z.literal('completed'),
  ai_summary: TextSchema,
}).superRefine(checkEstimateTotals)
