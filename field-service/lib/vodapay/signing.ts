import { createSign, createVerify } from 'node:crypto'

export function buildSignaturePayload(p: {
  method: string; path: string; clientId: string; requestTime: string; body: string
}): string {
  return `${p.method} ${p.path}\n${p.clientId}.${p.requestTime}.${p.body}`
}

export function signRequest(payload: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(payload, 'utf8')
  return signer.sign(privateKeyPem, 'base64')
}

export function verifySignature(payload: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(payload, 'utf8')
    return verifier.verify(publicKeyPem, signatureB64, 'base64')
  } catch {
    return false
  }
}

export function parseSignatureHeader(
  header: string | null,
): { algorithm: string; signature: string } | null {
  if (!header) return null
  const parts = new Map(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const
    }),
  )
  const algorithm = parts.get('algorithm')
  const signature = parts.get('signature')
  if (!algorithm || !signature) return null
  return { algorithm, signature: decodeURIComponent(signature) }
}
