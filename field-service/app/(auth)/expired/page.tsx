import Link from 'next/link'
import { Clock, ArrowRight } from 'lucide-react'
import { AuthShell } from '@/components/shared/auth-shell'
import { WA_ENABLED } from '@/lib/whatsapp-client'

const WA_NUMBER = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')

function WhatsAppIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
      width={16} height={16} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}

export default function LinkExpiredPage() {
  const waHref = WA_NUMBER ? `https://wa.me/${WA_NUMBER}` : null

  return (
    <AuthShell>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, marginTop: 8 }}>
        {/* Layered icon: gradient-soft shell → white card → clock */}
        <div style={{
          width: 88, height: 88, borderRadius: 28,
          background: 'var(--brand-gradient-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 18,
            background: 'var(--card)',
            boxShadow: 'inset 0 0 0 1px var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--warn, #E69900)',
          }}>
            <Clock size={28} />
          </div>
        </div>

        {/* Copy */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            margin: '0 0 8px',
            fontSize: 24, fontWeight: 700, letterSpacing: -0.5,
            color: 'var(--ink)',
          }}>
            This link has expired
          </h1>
          <p style={{
            margin: 0,
            fontSize: 14, lineHeight: 1.55,
            color: 'var(--ink-mute)',
          }}>
            We couldn&apos;t verify access to this request. The link may have been used
            or revoked. Open your most recent WhatsApp message from Plug A Pro, or
            start a new request.
          </p>
        </div>

        {/* CTAs */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link
            href="/book"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 52, borderRadius: 16,
              background: 'var(--brand-gradient)',
              color: '#fff', fontWeight: 700, fontSize: 15,
              textDecoration: 'none',
            }}
          >
            Start a new request
            <ArrowRight size={18} />
          </Link>

          <Link
            href="/sign-in"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 52, borderRadius: 16,
              background: 'var(--card)',
              boxShadow: 'inset 0 0 0 1px var(--border)',
              color: 'var(--ink)', fontWeight: 600, fontSize: 15,
              textDecoration: 'none',
            }}
          >
            Sign in to my account
          </Link>

          {WA_ENABLED && waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                height: 44, borderRadius: 16, border: 'none', cursor: 'pointer',
                background: 'transparent', color: '#1FAD52',
                fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
              }}
            >
              <WhatsAppIcon />
              Reopen WhatsApp chat
            </a>
          )}
        </div>
      </div>
    </AuthShell>
  )
}
