import * as React from 'react'
import {
  getProviderMarketplaceReviewDescription,
  getProviderMarketplaceReviewLabel,
} from '@/lib/provider-trust'

type ProviderTrustNoteProps = {
  marketplaceApproved: boolean
  className?: string
}

export function ProviderTrustNote({
  marketplaceApproved,
  className,
}: ProviderTrustNoteProps) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {getProviderMarketplaceReviewLabel(marketplaceApproved)}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {getProviderMarketplaceReviewDescription()}
      </p>
    </div>
  )
}
