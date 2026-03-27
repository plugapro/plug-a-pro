import type { JobStatusEvent } from '@prisma/client'

interface Props {
  events: JobStatusEvent[]
}

export function Timeline({ events }: Props) {
  return (
    <ol className="relative ml-3 border-l border-border space-y-4">
      {events.map((event, i) => (
        <li key={event.id} className="ml-6">
          <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary ring-2 ring-background" />
          <div>
            <p className="text-sm font-medium">{formatStatus(event.toStatus)}</p>
            {event.notes && (
              <p className="text-xs text-muted-foreground mt-0.5">{event.notes}</p>
            )}
            <time className="text-xs text-muted-foreground">
              {event.timestamp.toLocaleString('en-ZA', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {' · '}
              {event.actorRole}
            </time>
          </div>
        </li>
      ))}
    </ol>
  )
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
