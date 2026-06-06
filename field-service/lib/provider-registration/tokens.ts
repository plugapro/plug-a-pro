import { createHash, timingSafeEqual } from 'crypto'

export async function hashRegistrationResumeToken(token: string): Promise<string> {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function verifyRegistrationResumeToken(
  token: string,
  tokenHash: string,
): Promise<boolean> {
  const candidateHash = await hashRegistrationResumeToken(token)
  const candidate = Buffer.from(candidateHash, 'hex')
  const expected = Buffer.from(tokenHash, 'hex')

  if (candidate.length !== expected.length) return false

  return timingSafeEqual(candidate, expected)
}
