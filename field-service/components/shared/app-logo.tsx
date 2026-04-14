import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export function AppLogo({
  href = '/',
  priority = false,
  compact = false,
  className,
}: {
  href?: string
  priority?: boolean
  compact?: boolean
  className?: string
}) {
  const logo = (
    <Image
      src="/logo.png"
      alt="Plug-A-Pro"
      width={compact ? 92 : 104}
      height={compact ? 32 : 36}
      priority={priority}
      unoptimized
      className={cn(compact ? 'h-8 w-auto' : 'h-9 w-auto', className)}
    />
  )

  if (!href) return logo

  return (
    <Link href={href} className="flex items-center">
      {logo}
    </Link>
  )
}
