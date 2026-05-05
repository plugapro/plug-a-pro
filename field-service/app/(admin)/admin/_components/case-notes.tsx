'use client'

import { useRef, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { CaseNote } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { addCaseNoteAction } from '../_actions/case'
import { toast } from 'sonner'

interface Props {
  caseId: string
  notes: Pick<CaseNote, 'id' | 'body' | 'authorUserId' | 'createdAt'>[]
}

export function CaseNotes({ caseId, notes }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    const body = ((formData.get('body') as string) ?? '').trim()
    if (!body) return
    startTransition(async () => {
      const result = await addCaseNoteAction({ caseId, body })
      if (result.ok) {
        formRef.current?.reset()
        toast.success('Note added')
      } else {
        toast.error('Failed to add note')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {notes.length === 0 && (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        )}
        {notes.map((note) => (
          <div key={note.id} className="rounded-md border p-3 text-sm">
            <p className="whitespace-pre-wrap">{note.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {note.authorUserId} ·{' '}
              {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
            </p>
          </div>
        ))}
      </div>

      <form ref={formRef} action={handleSubmit} className="space-y-2">
        <Textarea name="body" placeholder="Add an internal note…" rows={3} required />
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : 'Add note'}
        </Button>
      </form>
    </div>
  )
}
