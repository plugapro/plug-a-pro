import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '@/components/ui/button'
import { FormSubmitButton } from '@/components/ui/form-submit-button'

/**
 * Tests the pending-state UX primitives shipped in commits a2b0ed8 and
 * 1c152ff. Vitest runs in the `node` environment so we cannot exercise
 * useState / useFormStatus interactively — those code paths are covered
 * by Playwright (e2e/smoke.spec.ts). What we CAN verify deterministically:
 *
 *   1. Button without `loading` renders children verbatim (back-compat).
 *   2. Button with `loading={true}` swaps to loadingLabel, forces
 *      `disabled`, sets `aria-busy="true"`, and injects a spinning svg.
 *   3. Button with `loading={true}` and no loadingLabel keeps children
 *      (the explicit-label override is the documented pattern).
 *   4. Button with `asChild` bypasses loading visuals (Slot's single-child
 *      contract — spinner sibling would break it).
 *   5. FormSubmitButton outside a form renders the underlying button
 *      with pending=false (useFormStatus default).
 *   6. Module-load smoke for FormSubmitButton — catches import-path
 *      regressions and circular dependencies introduced by future edits.
 */
describe('Button — loading prop', () => {
  it('renders children verbatim when loading is omitted (back-compat)', () => {
    const html = renderToStaticMarkup(<Button>Save changes</Button>)
    expect(html).toContain('Save changes')
    expect(html).not.toMatch(/aria-busy="true"/)
    expect(html).not.toMatch(/<svg[^>]*lucide-loader/)
    // Match the disabled boolean attribute (React serializes as `disabled=""`),
    // not the many `disabled:*` Tailwind variants baked into the class string.
    expect(html).not.toMatch(/<button[^>]*\sdisabled=/)
  })

  it('swaps to loadingLabel, sets aria-busy, forces disabled, renders spinner', () => {
    const html = renderToStaticMarkup(
      <Button loading loadingLabel="Saving…">Save changes</Button>,
    )
    expect(html).toContain('Saving…')
    expect(html).not.toContain('Save changes')
    expect(html).toMatch(/aria-busy="true"/)
    expect(html).toMatch(/<button[^>]*\sdisabled=/)
    // lucide-react renders Loader2 as <svg ... class="lucide lucide-loader-circle animate-spin">
    expect(html).toMatch(/animate-spin/)
  })

  it('keeps children when loading=true and no loadingLabel is supplied', () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>)
    expect(html).toContain('Save')
    expect(html).toMatch(/<button[^>]*\sdisabled=/)
    expect(html).toMatch(/animate-spin/)
  })

  it('respects caller-provided disabled when loading is false', () => {
    const html = renderToStaticMarkup(<Button disabled>Locked</Button>)
    expect(html).toMatch(/<button[^>]*\sdisabled=/)
    expect(html).not.toMatch(/aria-busy="true"/)
  })

  it('asChild bypasses loading visuals to preserve Slot single-child contract', () => {
    // Even with loading=true, asChild defers to the child; no spinner sibling.
    const html = renderToStaticMarkup(
      <Button asChild loading loadingLabel="Saving…">
        <a href="/somewhere">Go</a>
      </Button>,
    )
    expect(html).toContain('Go')
    expect(html).not.toMatch(/animate-spin/)
    expect(html).not.toMatch(/aria-busy/)
  })
})

describe('FormSubmitButton', () => {
  it('renders children and submit type when outside a form (pending defaults to false)', () => {
    const html = renderToStaticMarkup(
      <FormSubmitButton pendingLabel="Submitting…">Submit</FormSubmitButton>,
    )
    expect(html).toContain('Submit')
    expect(html).not.toContain('Submitting…')
    expect(html).toMatch(/type="submit"/)
    expect(html).not.toMatch(/aria-busy="true"/)
  })

  it('module exports a function (catches import-path regressions)', async () => {
    const mod = await import('@/components/ui/form-submit-button')
    expect(typeof mod.FormSubmitButton).toBe('function')
  })
})
