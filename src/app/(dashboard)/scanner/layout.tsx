import { Suspense, type ReactNode } from 'react'
import { unstable_cache } from 'next/cache'
import { isOneWellnessFundingAvailable, ONE_WELLNESS_FUNDING_URL } from '@/lib/one-wellness-funding'

const available = unstable_cache(
  (release: string) => isOneWellnessFundingAvailable(release),
  ['purama-one-wellness-funding-v1'],
  { revalidate: 300 },
)

async function WellnessFundingLink() {
  const release = process.env.PURAMA_ONE_WELLNESS_FUNDING_RELEASED
  if (release !== 'true' || !await available(release)) return null
  return (
    <p className="mt-5">
      <a className="text-emerald-700 underline dark:text-emerald-300"
        href={ONE_WELLNESS_FUNDING_URL} referrerPolicy="no-referrer">
        Vérifier mes aides au bien-être et ma mutuelle en France dans PURAMA ONE
      </a>
    </p>
  )
}

export default function ScannerLayout({ children }: { children: ReactNode }) {
  return <>{children}<Suspense fallback={null}><WellnessFundingLink /></Suspense></>
}
