import Link from 'next/link'
import { Button } from '@/components/ui/button'
export default function ReviewThanksPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="text-5xl">⭐</div>
        <h1 className="text-2xl font-semibold tracking-tight">Thanks for your review!</h1>
        <p className="text-muted-foreground">Your feedback helps us keep quality high and rewards great providers on Plug A Pro.</p>
        <Button asChild variant="outline" className="w-full"><Link href="/">Back to home</Link></Button>
      </div>
    </main>
  )
}
