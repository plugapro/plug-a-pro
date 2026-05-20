'use client'

type NewRequestWizardProps = {
  resumeId?: string
}

export function NewRequestWizard({ resumeId }: NewRequestWizardProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">New Request</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The new request wizard is being prepared. Please use WhatsApp to submit your request in the meantime.
      </p>
      {resumeId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Resume reference: {resumeId}
        </p>
      ) : null}
    </div>
  )
}
