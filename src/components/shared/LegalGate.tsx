'use client'

import LegalReacceptanceGate from '@/lib/legal/components/LegalReacceptanceGate'
import type { LegalDocType } from '@/lib/legal/types'
import { APP_NAME } from '@/lib/constants'

/**
 * Pont client entre le calcul serveur de `docsEnAttente` ((dashboard)/layout.tsx) et le
 * composant présentationnel `LegalReacceptanceGate` du socle NIYAMA — voir CONFORMITE.md §9.
 */
export default function LegalGate({ docsEnAttente }: { docsEnAttente: LegalDocType[] }) {
  async function handleAccept(docType: LegalDocType) {
    const res = await fetch('/api/legal/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docType }),
    })
    if (!res.ok) throw new Error('Enregistrement de l\'acceptation impossible.')
  }

  return (
    <LegalReacceptanceGate appName={APP_NAME} docsEnAttente={docsEnAttente} onAccept={handleAccept} />
  )
}
