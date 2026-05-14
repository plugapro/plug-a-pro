import { getSession } from '@/lib/auth'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export default async function NotificationsPage() {
  const session = await getSession()

  return (
    <div className="min-h-screen pb-32 screen-enter" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <div className="px-[18px] pt-[60px] pb-4 flex items-center gap-3">
        <Link
          href="/"
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'var(--card-alt)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <ChevronLeft size={18} style={{ color: 'var(--ink)' }} />
        </Link>
        <h1
          className="font-bold tracking-[-0.025em]"
          style={{ fontSize: 28, color: 'var(--ink)' }}
        >
          Notifications
        </h1>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center px-6 pt-16 text-center">
        {/* Icon */}
        <div
          className="w-[88px] h-[88px] rounded-[28px] flex items-center justify-center mb-6"
          style={{ background: 'rgba(139,63,232,0.08)' }}
        >
          <div
            className="w-[56px] h-[56px] rounded-[18px] flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)',
              boxShadow: '0 8px 24px rgba(139,63,232,0.30)',
            }}
          >
            <svg
              aria-hidden
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
        </div>

        <h2
          className="font-bold tracking-[-0.02em] mb-2"
          style={{ fontSize: 22, color: 'var(--ink)' }}
        >
          {session ? 'No notifications yet' : 'Sign in to see notifications'}
        </h2>
        <p
          className="max-w-[280px]"
          style={{ fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.55 }}
        >
          {session
            ? "You're all caught up. We'll let you know when your booking status changes."
            : 'Sign in to receive updates on your bookings and requests.'}
        </p>

        {!session && (
          <Link
            href="/sign-in"
            className="mt-8 h-[52px] px-8 rounded-[14px] flex items-center justify-center text-[15px] font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #8B3FE8, #2A78F0)' }}
          >
            Sign in
          </Link>
        )}
      </div>
    </div>
  )
}
