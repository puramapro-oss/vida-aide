'use client'

import { useEffect, useRef, useState } from 'react'
import { ScanResultSchema } from '@/lib/scan-result'
import { attemptPayload, clearAttempt, loadAttempt, newAttempt, saveAttempt, scanContent, ScanRequestError, type ScanAttempt, type ScanPayload } from '@/lib/scan-attempt'

export function useScanRequest(owner?: string) {
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<ScanAttempt | null>(null)
  const [restored, setRestored] = useState<ScanPayload | null>(null)
  const current = useRef<ScanAttempt | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    generation.current += 1
    setReady(false); setError(null); setAttempt(null); setRestored(null); current.current = null
    if (owner) {
      try {
        const saved = loadAttempt(owner)
        current.current = saved; setAttempt(saved); setRestored(saved ? attemptPayload(saved) : null)
        setLoadedOwner(owner); setReady(true)
      } catch { setError('Impossible de lire la demande conservée. Prépare explicitement une nouvelle demande pour continuer.') }
    }
    return () => { generation.current += 1 }
  }, [owner])

  async function run(payload: ScanPayload) {
    if (!owner || !ready || loadedOwner !== owner || inFlight.current) return null
    const version = generation.current
    inFlight.current = true; setLoading(true); setError(null)
    try {
      const content = scanContent(payload)
      const request = current.current?.owner === owner && current.current.content === content ? current.current : newAttempt(owner, content)
      current.current = request; setAttempt(request)
      try { saveAttempt(request) }
      catch { throw new ScanRequestError('Impossible de conserver la demande dans cet onglet. Aucun scan n’a été lancé.') }
      const response = await fetch('/api/scan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...attemptPayload(request), request_id: request.requestId }),
      })
      const data: unknown = await response.json()
      if (version !== generation.current) return null
      if (!response.ok) {
        let message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error
          : 'Le résultat n’est pas confirmé. Reprends la même demande pour consulter son état.'
        if (response.status === 409 && data && typeof data === 'object' && 'scan_id' in data && data.scan_id === request.requestId && 'code' in data) {
          if (data.code === 'scan_in_progress') message = 'Cette demande est encore en cours. Reprends la même demande pour consulter son état, sans relancer le modèle.'
          if (data.code === 'scan_attempt_failed') message = 'Cette tentative est terminée sans résultat et reste décomptée. Pour relancer le modèle, prépare explicitement une nouvelle demande.'
        }
        throw new ScanRequestError(message)
      }
      const result = ScanResultSchema.safeParse(data)
      if (response.status !== 200 || !data || typeof data !== 'object' || !('ok' in data) || data.ok !== true
        || !('scan_id' in data) || data.scan_id !== request.requestId || !result.success) {
        throw new ScanRequestError('Réponse du scan non confirmée. Reprends cette même demande sans en créer une nouvelle.')
      }
      return { scanId: request.requestId, count: result.data.results.length }
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof ScanRequestError ? cause.message
        : 'Réponse du scan non confirmée. Reprends cette même demande sans en créer une nouvelle.')
      return null
    } finally {
      inFlight.current = false
      if (mounted.current) setLoading(false)
    }
  }

  function reset() {
    if (!owner || inFlight.current) return
    setReady(false); setError(null)
    try { clearAttempt(owner); current.current = null; setAttempt(null); setRestored(null); setLoadedOwner(owner); setReady(true) }
    catch { setError('Impossible de préparer une nouvelle demande dans cet onglet.') }
  }
  return { loading, ready: ready && loadedOwner === owner, error, attempt: attempt?.owner === owner ? attempt : null,
    restored: loadedOwner === owner ? restored : null, run, reset }
}
