'use client'
// ─── CaseNotesPanel ───────────────────────────────────────────────────────────
// Displays existing notes and an add-note form.
// The form posts to the parent server action via formAction prop.

import { useRef } from 'react'
import type { CaseNote } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function CaseNotesPanel({
  notes,
  addNoteAction,
}: {
  notes: CaseNote[]
  addNoteAction: (formData: FormData) => Promise<void>
}) {
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {note.authorUserId} ·{' '}
                <span title={new Date(note.createdAt).toLocaleString('en-ZA')}>
                  {relativeTime(new Date(note.createdAt))}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}
      <Separator />
      <form
        ref={formRef}
        action={async (fd) => {
          await addNoteAction(fd)
          formRef.current?.reset()
        }}
        className="space-y-2"
      >
        <Textarea
          name="body"
          placeholder="Add a note…"
          rows={3}
          required
          minLength={1}
          className="text-sm"
        />
        <Button type="submit" size="sm" variant="secondary">
          Save note
        </Button>
      </form>
    </div>
  )
}
