import { notFound } from 'next/navigation'
import { LEGAL_PAGES, LegalPageScreen } from '@/components/client/legal-screens'

export default async function ClientLegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = LEGAL_PAGES.find((item) => item.slug === slug)
  if (!page) notFound()
  return <LegalPageScreen title={page.title} blurb={page.blurb} path={page.path} />
}

