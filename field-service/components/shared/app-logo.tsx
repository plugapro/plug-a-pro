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
      src="/icon.png"
      alt="Plug A Pro"
      width={32}
      height={32}
      priority={priority}
      unoptimized
      className={cn('h-8 w-8', className)}
    />
  )

  if (!href) return logo

  return (
    <Link href={href} className="flex items-center">
      {logo}
    </Link>
  )
}
