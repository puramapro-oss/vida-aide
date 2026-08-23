import { NextResponse, type NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { CURRENT_LEGAL_VERSIONS } from '@/lib/legal/versions'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createServerSupabaseClient()

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Preuve d'acceptation CGU/CGV/confidentialité horodatée pour TOUT chemin d'auth
      // (le signup email l'appelle déjà côté client — ceci couvre Google OAuth, seul
      // parcours qui échangeait un code sans jamais poser cette preuve, cf CONFORMITE.md §3).
      // `ignoreDuplicates: true` : n'écrit qu'une fois par doc, ne réécrit jamais une
      // acceptation déjà en base — laisse `LegalReacceptanceGate` gérer les changements
      // de version pour les utilisateurs déjà connus.
      if (data.user) {
        await Promise.all(
          (['cgu', 'cgv', 'confidentialite'] as const).map((docType) =>
            supabase.from('legal_acceptances').upsert(
              {
                user_id: data.user!.id,
                doc_type: docType,
                version: CURRENT_LEGAL_VERSIONS[docType],
                ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
                user_agent: request.headers.get('user-agent'),
              },
              { onConflict: 'user_id,doc_type', ignoreDuplicates: true }
            )
          )
        )
      }

      return NextResponse.redirect(new URL(next, origin))
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth_failed', origin))
}
