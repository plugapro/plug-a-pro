import { Skeleton } from '@/components/ui/skeleton'

export default function ProviderProfileLoading() {
  return (
    <div className="min-h-screen pb-32 px-[18px]">
      {/* Header */}
      <div className="pt-[60px] pb-6">
        <Skeleton className="h-9 w-40 rounded-[12px]" />
      </div>

      {/* Profile hero card */}
      <div
        className="rounded-[20px] p-5 mb-4 flex items-center gap-4"
        style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
      >
        <Skeleton className="w-16 h-16 rounded-[20px] shrink-0" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-5 w-36 rounded-[8px]" />
          <Skeleton className="h-3 w-24 rounded-full" />
        </div>
      </div>

      {/* Form sections */}
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-[20px] p-5 mb-3 space-y-4"
          style={{ background: 'var(--card)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
        >
          <Skeleton className="h-3 w-20 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-11 w-full rounded-[12px]" />
          </div>
          {i < 3 && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-11 w-full rounded-[12px]" />
            </div>
          )}
        </div>
      ))}

      {/* Save button */}
      <Skeleton className="h-[52px] w-full rounded-[14px]" />
    </div>
  )
}
