'use client'

import { useEffect } from 'react'
import { captureUtmFromLocation } from '@/lib/utm'

export function UtmCapture() {
  useEffect(() => {
    captureUtmFromLocation()
  }, [])
  return null
}
