import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { JobStatusControls } from '@/components/technician/StatusControls'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

describe('provider job status controls', () => {
  it('shows on-the-way action for scheduled jobs', () => {
    const html = renderToStaticMarkup(
      <JobStatusControls jobId="job_123" currentStatus="SCHEDULED" />
    )

    expect(html).toContain('I&#x27;m on my way')
    expect(html).not.toContain('Mark complete')
  })

  it('shows next-step actions for active jobs', () => {
    const html = renderToStaticMarkup(
      <JobStatusControls jobId="job_123" currentStatus="STARTED" />
    )

    expect(html).toContain('Mark complete')
    expect(html).toContain('Pause')
  })

  it('renders no actions for terminal status', () => {
    const html = renderToStaticMarkup(
      <JobStatusControls jobId="job_123" currentStatus="COMPLETED" />
    )

    expect(html).toBe('')
  })
})
