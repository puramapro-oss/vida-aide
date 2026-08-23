'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { createClient } from '@/lib/supabase'
import Card from '@/components/ui/Card'
import MaMemoirePage, { type LegalAcceptanceRow } from '@/lib/legal/components/MaMemoirePage'
import { APP_NAME } from '@/lib/constants'

export default function MaMemoire() {
  const { user, loading: authLoading } = useAuth()
  const [acceptations, setAcceptations] = useState<LegalAcceptanceRow[]>([])
  const [deletionScheduledFor, setDeletionScheduledFor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const sb = createClient()
    Promise.all([
      sb.from('legal_acceptances').select('doc_type, version, accepted_at').eq('user_id', user.id),
      sb.from('account_deletion_requests').select('scheduled_for').eq('user_id', user.id).eq('status', 'scheduled').maybeSingle(),
    ]).then(([{ data: acc }, { data: del }]) => {
      setAcceptations(
        (acc ?? []).map((a) => ({ docType: a.doc_type, version: a.version, acceptedAt: a.accepted_at }))
      )
      setDeletionScheduledFor(del?.scheduled_for ?? null)
      setLoading(false)
    })
  }, [user])

  if (authLoading || loading) {
    return <Card className="mx-auto mt-12 max-w-2xl p-8 text-center text-sm text-[var(--text-muted)]">Chargement…</Card>
  }

  return (
    <MaMemoirePage
      appName={APP_NAME}
      acceptations={acceptations}
      deletionScheduledFor={deletionScheduledFor}
    />
  )
}
