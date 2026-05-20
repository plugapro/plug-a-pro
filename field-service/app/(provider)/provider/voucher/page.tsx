'use client'

import { useState, useTransition } from 'react'
import { redeemVoucherAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function VoucherRedemptionPage() {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await redeemVoucherAction(code)
      if (result.ok) {
        setCode('')
        setMessage({ text: result.message, type: 'success' })
      } else {
        setMessage({ text: result.message, type: 'error' })
      }
    })
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Redeem Voucher</CardTitle>
          <CardDescription>
            Enter the voucher code from your printed flyer to add 1 credit to your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="voucher-code">Voucher Code</Label>
              <Input
                id="voucher-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="PAP-XXXX-XXXX"
                className="mt-1 font-mono tracking-widest"
                autoComplete="off"
                spellCheck={false}
                disabled={isPending}
              />
            </div>

            {message && (
              <p
                className={
                  message.type === 'success'
                    ? 'text-sm text-green-700'
                    : 'text-sm text-red-600'
                }
              >
                {message.text}
              </p>
            )}

            <Button type="submit" disabled={isPending || !code.trim()} className="w-full">
              {isPending ? 'Redeeming…' : 'Redeem Voucher'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
