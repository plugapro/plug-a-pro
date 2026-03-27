import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string | number
  description: string
  href?: string
  highlight?: boolean
}

export function KpiCard({ label, value, description, href, highlight }: KpiCardProps) {
  const content = (
    <Card className={cn(
      'transition-colors',
      highlight && 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20',
      href && 'hover:bg-muted/50 cursor-pointer'
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }
  return content
}
