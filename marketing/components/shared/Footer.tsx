import Link from "next/link";
import Image from "next/image";
import { siteConfig } from "@/lib/metadata";
import { WhatsAppButton } from "@/components/marketing/WhatsAppButton";
import { whatsappNumberDisplay } from "@/lib/whatsapp";

export function Footer() {
  return (
    <footer className="border-t border-border/40 py-12 mt-auto">
      <div className="container mx-auto max-w-5xl px-4 flex flex-col md:flex-row justify-between gap-8 text-sm text-muted-foreground">
        <div>
          <Image src="/logo-nav.png" alt={siteConfig.name} width={318} height={110} className="h-12 w-auto mb-2" />
          <p>{siteConfig.description}</p>
          <p className="mt-3">WhatsApp: {whatsappNumberDisplay}</p>
          <WhatsAppButton source="footer" />
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-foreground text-xs uppercase tracking-wider">Platform</span>
            <Link href="/how-it-works" className="hover:text-foreground transition-colors">How it works</Link>
            <Link href="/for-customers" className="hover:text-foreground transition-colors">For customers</Link>
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
      <div className="container mx-auto max-w-5xl px-4 mt-8 pt-6 border-t border-border/40 text-xs text-muted-foreground flex justify-between items-center">
        <span>© {new Date().getFullYear()} {siteConfig.name}</span>
        <div className="flex items-center gap-4">
          <Link href={siteConfig.links.twitter} target="_blank" rel="noopener noreferrer" aria-label="X / Twitter" className="hover:text-foreground transition-colors">
            {/* X (Twitter) icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </Link>
          <Link href={siteConfig.links.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
            </svg>
          </Link>
          {siteConfig.links.facebook && (
            <Link href={siteConfig.links.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="hover:text-foreground transition-colors">
              {/* Facebook icon */}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </Link>
          )}
        </div>
      </div>
    </footer>
  );
}
