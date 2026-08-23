import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import BottomTabBar from '@/components/layout/BottomTabBar'
import OnboardingFlow from '@/components/shared/OnboardingFlow'
import LegalGate from '@/components/shared/LegalGate'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { computeDocsEnAttente } from '@/lib/legal/versions'
import type { LegalDocType } from '@/lib/legal/types'

/**
 * Docs légaux dont la version acceptée par l'utilisateur courant est absente ou périmée.
 * Calcul côté serveur (RLS `legal_acceptances` = ligne de l'utilisateur uniquement) — voir
 * CONFORMITE.md §9. `mentions` exclu volontairement : aucune mécanique de consentement
 * explicite ne la couvre dans l'app (pas de bouton dédié), l'inclure bloquerait tout le
 * monde en permanence (même convention appliquée ailleurs dans l'écosystème PURAMA).
 */
async function getDocsEnAttente(): Promise<LegalDocType[]> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('legal_acceptances')
    .select('doc_type, version')
    .eq('user_id', user.id)

  const dernieresAcceptations = Object.fromEntries(
    (data ?? []).map((row) => [row.doc_type, row.version])
  ) as Partial<Record<LegalDocType, string>>

  return computeDocsEnAttente(dernieresAcceptations).filter((doc) => doc !== 'mentions')
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const docsEnAttente = await getDocsEnAttente()

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="lg:pl-60">
        <Topbar />
        <main className="min-h-[calc(100vh-4rem)] p-4 pb-20 lg:p-8 lg:pb-8">
          {children}
        </main>
      </div>
      <BottomTabBar />
      <OnboardingFlow />
      <LegalGate docsEnAttente={docsEnAttente} />
    </div>
  )
}
