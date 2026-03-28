import Link from "next/link";
import { siteConfig } from "@/lib/metadata";
import { WhatsAppButton } from "@/components/marketing/WhatsAppButton";

export function Footer() {
  return (
    <footer className="border-t border-border/40 py-12 mt-auto">
      <div className="container mx-auto max-w-5xl px-4 flex flex-col md:flex-row justify-between gap-8 text-sm text-muted-foreground">
        <div>
          <p className="font-semibold text-foreground mb-1">{siteConfig.name}</p>
          <p>{siteConfig.description}</p>
          <WhatsAppButton />
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground text-xs uppercase tracking-wider">Platform</span>
            <Link href="/how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
            <Link href="/for-workers" className="hover:text-foreground transition-colors">For workers</Link>
            <Link href="/solutions" className="hover:text-foreground transition-colors">Services</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground text-xs uppercase tracking-wider">Help</span>
            <Link href="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
            <Link href="/trust" className="hover:text-foreground transition-colors">Trust &amp; Safety</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground text-xs uppercase tracking-wider">Company</span>
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </nav>
      </div>
      <div className="container mx-auto max-w-5xl px-4 mt-8 pt-6 border-t border-border/40 text-xs text-muted-foreground flex justify-between">
        <span>© {new Date().getFullYear()} {siteConfig.name}</span>
        <Link href={siteConfig.links.twitter} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Twitter</Link>
      </div>
    </footer>
  );
}
