import Link from "next/link";
import Image from "next/image";
import { siteConfig } from "@/lib/metadata";
import { WhatsAppButton } from "@/components/marketing/WhatsAppButton";

export function Footer() {
  return (
    <footer className="border-t border-border/40 py-12 mt-auto">
      <div className="container mx-auto max-w-5xl px-4 flex flex-col md:flex-row justify-between gap-8 text-sm text-muted-foreground">
        <div className="max-w-xs">
          <Link href="/" className="flex items-center gap-2 mb-2">
            <Image
              src="/icon.png"
              alt="Plug-A-Pro"
              width={28}
              height={28}
              className="rounded-md"
            />
            <span className="font-semibold text-foreground">{siteConfig.name}</span>
          </Link>
          <p className="text-xs leading-relaxed mb-4">
            Field service management for South African service businesses. WhatsApp-first, built for the way your team actually works.
          </p>
          <WhatsAppButton />
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground text-xs uppercase tracking-wider">Platform</span>
            <Link href="/how-it-works" className="hover:text-foreground transition-colors">How It Works</Link>
            <Link href="/solutions" className="hover:text-foreground transition-colors">Solutions</Link>
            <Link href="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground text-xs uppercase tracking-wider">Company</span>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </nav>
      </div>
      <div className="container mx-auto max-w-5xl px-4 mt-8 pt-6 border-t border-border/40 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between gap-2">
        <span>© {new Date().getFullYear()} {siteConfig.name} · South Africa</span>
        <span>Payments by Peach Payments · ZAR · +27</span>
      </div>
    </footer>
  );
}
