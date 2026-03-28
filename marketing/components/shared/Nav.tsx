import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const navLinks = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/for-customers", label: "For customers" },
  { href: "/for-workers", label: "For workers" },
  { href: "/trust", label: "Trust & Safety" },
  { href: "/faq", label: "FAQ" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center">
          <Image
            src="/logo-nav.png"
            alt="Plug-A-Pro"
            width={318}
            height={43}
            className="h-6 w-auto dark:hidden"
            priority
          />
          <span className="hidden dark:inline font-bold text-base brand-gradient-text">
            Plug-A-Pro
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            nativeButton={false}
            render={<Link href="/waitlist" />}
            size="sm"
          >
            Request help
          </Button>
        </div>
      </div>
    </header>
  );
}
