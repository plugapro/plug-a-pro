import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActionFormContext } from '@/components/admin/ui/ActionForm'
import { SubmitButton } from '@/components/admin/ui/SubmitButton'

describe('SubmitButton with ActionForm context', () => {
  it('shows pending label and disables button when ActionForm is pending', () => {
    const html = renderToStaticMarkup(
      <ActionFormContext.Provider value={{ isPending: true }}>
        <SubmitButton pendingLabel="Saving...">Save changes</SubmitButton>
      </ActionFormContext.Provider>,
    )

    expect(html).toContain('Saving...')
    expect(html).not.toContain('Save changes')
    expect(html).toMatch(/<button[^>]*\sdisabled=/)
    expect(html).toMatch(/animate-spin/)
  })
})
