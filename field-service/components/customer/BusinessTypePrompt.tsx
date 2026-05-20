'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setCustomerAccountTypeAction } from '@/app/(customer)/account/actions'

type Step = 'choose' | 'business'

export function BusinessTypePrompt() {
  const [open, setOpen] = React.useState(true)
  const [step, setStep] = React.useState<Step>('choose')
  const [businessName, setBusinessName] = React.useState('')
  const [pending, setPending] = React.useState(false)

  async function handlePersonal() {
    setPending(true)
    try {
      await setCustomerAccountTypeAction({ type: 'personal' })
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  async function handleBusiness() {
    setPending(true)
    try {
      await setCustomerAccountTypeAction({
        type: 'business',
        businessName: businessName.trim() || undefined,
      })
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        {step === 'choose' ? (
          <>
            <DialogHeader>
              <DialogTitle>How will you use Plug A Pro?</DialogTitle>
              <DialogDescription>
                Is this account for personal or business use?
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={() => setStep('business')}
                disabled={pending}
                className="w-full"
              >
                Business use
              </Button>
              <Button
                variant="outline"
                onClick={handlePersonal}
                disabled={pending}
                className="w-full"
              >
                Personal use
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Business name</DialogTitle>
              <DialogDescription>
                Optionally add your business name - you can update this later in your profile.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="business-name">Business name (optional)</Label>
                <Input
                  id="business-name"
                  placeholder="e.g. Acme Repairs (Pty) Ltd"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={pending}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={handleBusiness} disabled={pending} className="w-full">
                  {pending ? 'Saving…' : 'Continue'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setStep('choose')}
                  disabled={pending}
                  className="w-full"
                >
                  Back
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
