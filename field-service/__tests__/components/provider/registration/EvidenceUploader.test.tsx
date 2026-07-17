// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EvidenceUploader } from '@/components/provider/registration/EvidenceUploader'

/**
 * Vitest's global environment is `node` (no jsdom), so most tests in this
 * file render to a static HTML string and assert on structure.
 *
 * This file opts into a jsdom environment (via the pragma above) so the
 * per-file upload/retry interaction tests below can use
 * @testing-library/react + user-event. renderToStaticMarkup-based tests
 * are unaffected by the environment and continue to work as before.
 */
describe('EvidenceUploader', () => {
  it('shows "2 of 3" counter and an add-photos control when two items are present', () => {
    const html = renderToStaticMarkup(
      <EvidenceUploader
        value={['u1', 'u2']}
        onChange={() => {}}
        min={3}
        uploadFile={async () => ''}
      />,
    )
    expect(html).toContain('2 of 3')
    // The add-photos control must be present (button text or input type=file)
    expect(html.toLowerCase()).toContain('add photos')
    // Add button must not be disabled when min is not reached
    expect(html).toMatch(/<button[^>]*aria-label="Add work photos"[^>]*>/)
    expect(html).not.toMatch(/<button[^>]*aria-label="Add work photos"[^>]*\bdisabled\b[^>]*>/)
  })

  it('allows a provider to select multiple evidence photos at once', () => {
    const html = renderToStaticMarkup(
      <EvidenceUploader
        value={[]}
        onChange={() => {}}
        min={3}
        uploadFile={async () => ''}
      />,
    )
    expect(html).toMatch(/<input[^>]*type="file"[^>]*\bmultiple(?:=""|="true")?[^>]*>/)
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

  it('shows the why-we-ask helper copy and example chips', () => {
    render(<EvidenceUploader value={[]} onChange={() => {}} min={3} uploadFile={vi.fn()} />)
    // No @testing-library/jest-dom in this repo; getByText already throws
    // (failing the test) if no match is found, so a truthy check suffices.
    expect(screen.getByText(/customers pick providers with real work photos/i)).toBeTruthy()
    expect(screen.getByText(/finished job/i)).toBeTruthy()
    expect(screen.getByText(/before & after/i)).toBeTruthy()
    expect(screen.getByText(/you at work/i)).toBeTruthy()
  })

  it('offers per-file retry when one file in a batch fails', async () => {
    const user = userEvent.setup()
    const uploadFile = vi
      .fn<(file: File) => Promise<string>>()
      .mockResolvedValueOnce('https://x.public.blob.vercel-storage.com/a.jpg')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('https://x.public.blob.vercel-storage.com/b.jpg')
    const onChange = vi.fn()
    render(<EvidenceUploader value={[]} onChange={onChange} min={3} uploadFile={uploadFile} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' })
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' })
    await user.upload(input, [fileA, fileB])

    // fileA succeeded, fileB failed and shows a retry button
    expect(onChange).toHaveBeenCalledWith(['https://x.public.blob.vercel-storage.com/a.jpg'])
    const retry = await screen.findByRole('button', { name: /retry b\.jpg/i })
    await user.click(retry)
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.arrayContaining(['https://x.public.blob.vercel-storage.com/b.jpg']),
      ),
    )
  })
})
