import Link from "next/link";
import Image from "next/image";
import { siteConfig } from "@/lib/metadata";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

const navLinks = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/solutions", label: "Solutions" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-sm">
          <Image
            src="/icon.png"
            alt="Plug-A-Pro"
            width={28}
            height={28}
            className="rounded-md"
          />
          {siteConfig.name}
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
            render={
              <Link
                href={`https://wa.me/${siteConfig.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent("Hi, I'd like to get started with Plug-A-Pro")}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            size="sm"
            className="btn-gradient"
          >
            Start on WhatsApp
          </Button>
        </div>
      </div>
    </header>
  );
}
