'use client';

// Admin-wide error boundary. Catches render/data errors in any /admin/** route
// and renders a graceful fallback instead of a white screen.
//
// Copy this file to:
//   src/app/admin/error.tsx                               (shell-wide catch)
//   src/app/admin/providers/[id]/error.tsx                (provider detail specifically)
//   src/app/admin/bookings/[id]/error.tsx                 (booking detail specifically)
//   ... any other route you want scoped error handling for.
//
// Next.js App Router picks this up automatically when a server component or
// client component throws.

import * as React from 'react';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminError({ error, reset }: Props) {
  // In production, this is where you'd send to Sentry / log aggregator.
  React.useEffect(() => {
    console.error('[admin error boundary]', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl p-8">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-900">
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="mt-2 text-sm">
          The rest of the admin is still fine — you can navigate away and retry later.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs">
            Request ID: <span className="rounded bg-white px-1">{error.digest}</span>
          </p>
        )}
        <p className="mt-3 font-mono text-xs break-all">
          {error.name}: {error.message}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={reset}
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
          >
            Retry
          </button>
          <a href="/admin" className="rounded border border-red-300 px-3 py-1.5 text-sm">
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
