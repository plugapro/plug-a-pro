// Anonymous layout for /provider/signup — bypasses the (provider) group layout
// which calls requireProvider(). This page is token-gated, not session-gated.

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
