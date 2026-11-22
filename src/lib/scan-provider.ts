import { scanFinancialJSON } from '@/lib/claude'
import type { Plan } from '@/types'
import type { ScanIntent } from '@/lib/scan-admission'

export const SCAN_PROVIDER_TIMEOUT_MS = 100_000

export class ScanProviderInterrupted extends Error {
  constructor(public readonly reason: 'timeout' | 'cancelled') {
    super('Scan provider interrupted')
  }
}

/** The saved attempt outlives a lost response. Cancellation never refunds its
 * quota slot or authorizes a second paid call with the same request identity. */
export async function obtainScanEstimate(intent: ScanIntent, plan: Plan, requestSignal: AbortSignal): Promise<unknown> {
  if (requestSignal.aborted) throw new ScanProviderInterrupted('cancelled')
  const controller = new AbortController()
  let interrupted: ScanProviderInterrupted | undefined
  let rejectInterruption: (reason: Error) => void = () => {}
  const interruption = new Promise<never>((_, reject) => { rejectInterruption = reject })
  const interrupt = (reason: 'timeout' | 'cancelled') => {
    interrupted = new ScanProviderInterrupted(reason)
    controller.abort(interrupted)
    rejectInterruption(interrupted)
  }
  const onCancel = () => interrupt('cancelled')
  requestSignal.addEventListener('abort', onCancel, { once: true })
  const timeout = setTimeout(() => interrupt('timeout'), SCAN_PROVIDER_TIMEOUT_MS)
  try {
    const generation = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw interrupted
      return scanFinancialJSON(intent.input, intent.type, plan, controller.signal)
    })
    return await Promise.race([generation, interruption])
  } catch (error) {
    throw interrupted ?? error
  } finally {
    clearTimeout(timeout)
    requestSignal.removeEventListener('abort', onCancel)
  }
}
