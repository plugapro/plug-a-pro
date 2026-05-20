import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function read(path: string) {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('dropdown/select mobile layering contracts', () => {
  it('maps semantic theme tokens so bg-popover and bg-background resolve', () => {
    const css = read('app/globals.css')
    expect(css).toContain('@theme inline')
    expect(css).toContain('--color-popover: var(--popover);')
    expect(css).toContain('--color-background: var(--background);')
  })

  it('keeps shared Select content portal-rendered with opaque popover surface and elevated layer', () => {
    const selectFile = read('components/ui/select.tsx')
    expect(selectFile).toContain('<SelectPrimitive.Portal>')
    expect(selectFile).toContain('layer-dropdown')
    expect(selectFile).toContain('bg-popover/100')
  })

  it('keeps shared DropdownMenu content on opaque popover surface and elevated layer', () => {
    const dropdownFile = read('components/ui/dropdown-menu.tsx')
    expect(dropdownFile).toContain('layer-dropdown')
    expect(dropdownFile).toContain('bg-popover/100')
  })
})
