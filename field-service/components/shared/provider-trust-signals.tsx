import { Badge } from '@/components/ui/badge'
import {
  getProviderTrustProvenanceLabel,
  type ProviderTrustSignal,
} from '@/lib/provider-trust'

export function ProviderTrustSignals({
  signals,
}: {
  signals: ProviderTrustSignal[]
}) {
  if (signals.length === 0) return null

  return (
    <div className="space-y-3">
      {signals.map((signal) => (
        <div key={`${signal.provenance}:${signal.label}`} className="rounded-lg border px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">{signal.label}</p>
            <Badge variant="outline" className="shrink-0 rounded-full text-[10px] uppercase tracking-wide">
              {getProviderTrustProvenanceLabel(signal.provenance)}
            </Badge>
          </div>
          <p className="mt-2 text-sm">{signal.value}</p>
          {signal.description && (
            <p className="mt-2 text-xs text-muted-foreground">{signal.description}</p>
          )}
        </div>
      ))}
    </div>
  )
}
