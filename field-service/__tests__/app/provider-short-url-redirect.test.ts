import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('provider flyer short URL', () => {
  const joinPage = readFileSync(
    join(process.cwd(), 'app/join/page.tsx'),
    'utf8',
  )

  it('/join is a server-side redirect to /provider-sign-in', () => {
    expect(joinPage).toContain("from 'next/navigation'")
    expect(joinPage).toContain("permanentRedirect('/provider-sign-in')")
    expect(joinPage).not.toContain("'use client'")
  })
})
