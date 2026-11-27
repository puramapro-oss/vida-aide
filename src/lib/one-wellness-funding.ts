// This destination belongs to the existing ONE public origin. Neither a
// scanner result nor a practitioner referral belongs in its URL or headers.
export const ONE_WELLNESS_FUNDING_URL = 'https://purama.dev/revenus/financement/aides-bien-etre'

const pageTitle = '<title>Aides au bien-être et à l’alimentation | PURAMA ONE</title>'
const maximumHeadBytes = 64 * 1024

/** Public deployment probe, called through Next's five-minute result cache.
 * Fail closed on redirects, an unrelated landing page or a missing release. */
export async function isOneWellnessFundingAvailable(
  releaseConfirmed: string | undefined, request: typeof fetch = fetch,
): Promise<boolean> {
  if (releaseConfirmed !== 'true') return false
  try {
    const response = await request(ONE_WELLNESS_FUNDING_URL, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(1500),
    })
    if (!response.body) return false
    const reader = response.body.getReader()
    try {
      if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) return false
      const decoder = new TextDecoder()
      let html = ''
      let remaining = maximumHeadBytes
      while (remaining > 0) {
        const { done, value } = await reader.read()
        if (done) break
        const bytes = value.subarray(0, remaining)
        html += decoder.decode(bytes, { stream: true })
        remaining -= bytes.byteLength
        const headEnd = html.indexOf('</head>')
        const titleStart = html.indexOf(pageTitle)
        if (titleStart >= 0 && (headEnd < 0 || titleStart < headEnd)) return true
        if (headEnd >= 0) break
      }
      return false
    } finally {
      await reader.cancel()
    }
  } catch {
    return false
  }
}
