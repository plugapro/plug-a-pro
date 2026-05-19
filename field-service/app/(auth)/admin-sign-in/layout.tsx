import { Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google'

const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans-admin',
})

const mono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-admin',
})

export default function AdminSignInLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      className={`${sans.variable} ${mono.variable} min-h-screen bg-[#08080C] text-white antialiased`}
    >
      {children}
    </div>
  )
}
