import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "next-themes";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { buildMetadata } from "@/lib/metadata";
import { ChatWidget } from "@/components/marketing/ChatWidget";
import { ConsentBanner } from "@/components/marketing/ConsentBanner";
import "./globals.css";

export const metadata: Metadata = buildMetadata({});

// GA4 measurement ID is env-driven. It falls back to the original property so prod
// keeps working until NEXT_PUBLIC_GA_ID is set, and GA only loads on the production
// deployment so preview/local traffic never pollutes the prod property.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-R3RH07RQ3G";
const GA_ENABLED = process.env.VERCEL_ENV === "production" && Boolean(GA_ID);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <ChatWidget />
          {GA_ENABLED && <ConsentBanner />}
        </ThemeProvider>
      </body>
      {GA_ENABLED && (
        <>
          {/* Consent Mode v2: default everything to denied BEFORE GA loads, so no
              analytics/ad cookies are set until the visitor accepts (POPIA). The
              ConsentBanner flips these to "granted" on accept. */}
          <Script
            id="ga-consent-default"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html:
                "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}" +
                "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});",
            }}
          />
          <GoogleAnalytics gaId={GA_ID} />
        </>
      )}
    </html>
  );
}
