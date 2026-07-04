import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EvidenceUploader } from '@/components/provider/registration/EvidenceUploader'

/**
 * Vitest runs in the `node` environment (no jsdom), so @testing-library/react
 * is not used. We render to a static HTML string and assert on structure.
 *
 * Interactive behavior (file picker onChange, upload call, remove button click)
 * is covered by Playwright e2e per repo convention.
 */
describe('EvidenceUploader', () => {
  it('shows "2 of 3" counter and an add-photo control when two items are present', () => {
    const html = renderToStaticMarkup(
      <EvidenceUploader
        value={['u1', 'u2']}
        onChange={() => {}}
        min={3}
        uploadFile={async () => ''}
      />,
    )
    expect(html).toContain('2 of 3')
    // The add-photo control must be present (button text or input type=file)
    expect(html.toLowerCase()).toContain('add photo')
  })

  it('renders one <img per url and shows "3 of 3" when all three are present', () => {
    const urls = [
      'https://a.public.blob.vercel-storage.com/evidence/1.jpg',
      'https://a.public.blob.vercel-storage.com/evidence/2.jpg',
      'https://a.public.blob.vercel-storage.com/evidence/3.jpg',
    ]
    const html = renderToStaticMarkup(
      <EvidenceUploader
        value={urls}
        onChange={() => {}}
        min={3}
        uploadFile={async () => ''}
      />,
    )
    // Three thumbnail images
    const imgMatches = html.match(/<img\s/g)
    expect(imgMatches).not.toBeNull()
    expect(imgMatches!.length).toBe(3)
    expect(html).toContain('3 of 3')
  })

  it('renders all value items regardless of URL format (value is trusted)', () => {
    // URL validation applies to newly-uploaded files, NOT to pre-supplied value.
    const html = renderToStaticMarkup(
      <EvidenceUploader
        value={['u1', 'u2', 'u3']}
        onChange={() => {}}
        min={3}
        uploadFile={async () => ''}
      />,
    )
    const imgMatches = html.match(/<img\s/g)
    expect(imgMatches).not.toBeNull()
    expect(imgMatches!.length).toBe(3)
    expect(html).toContain('3 of 3')
  })

  it('disabled prop passes through and the add button is rendered disabled', () => {
    const html = renderToStaticMarkup(
      <EvidenceUploader
        value={[]}
        onChange={() => {}}
        min={3}
        uploadFile={async () => ''}
        disabled
      />,
    )
    expect(html).toContain('0 of 3')
    // Disabled button should carry disabled attribute
    expect(html).toMatch(/<button[^>]*\sdisabled[^>]*>/)
  })
})
