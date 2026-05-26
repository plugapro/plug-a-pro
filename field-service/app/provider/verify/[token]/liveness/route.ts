import { decryptIdentifier } from '@/lib/identity-verification/crypto'
import { db } from '@/lib/db'
import { resolveProviderVerificationToken } from '@/lib/provider-verification-token'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const verification = await resolveProviderVerificationToken(token)

  if (
    !verification.livenessSessionUrlEncrypted ||
    !verification.livenessSessionExpiresAt ||
    verification.livenessSessionExpiresAt <= new Date()
  ) {
    return redirectResponse(`/provider/verify/${encodeURIComponent(token)}/liveness/expired`)
  }

  const vendorUrl = decryptIdentifier(verification.livenessSessionUrlEncrypted)
  await db.providerSensitiveDataAccessLog.create({
    data: {
      verificationId: verification.id,
      actorId: verification.providerId ?? 'system:identity-liveness',
      actorRole: verification.providerId ? 'provider' : 'system',
      accessType: 'SIGNED_URL_ISSUED',
    },
  })

  return redirectResponse(vendorUrl)
}

function redirectResponse(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    },
  })
}
