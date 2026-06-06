"use client";

import Link from "next/link";
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { analytics } from "@/lib/analytics";
import { getProviderRegistrationUrl } from "@/lib/provider-registration-url";

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

interface ProviderRegistrationCtaProps {
  label: string;
  source: string;
  className?: string;
}

interface ProviderRegistrationCtaButtonProps extends ProviderRegistrationCtaProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: CSSProperties;
}

type ProviderRegistrationCtaLinkProps = ProviderRegistrationCtaProps & {
  className?: string;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "href" | "children" | "className">;

function trackProviderRegistrationClick(label: string, source: string) {
  analytics.providerRegistrationClick(source);
  analytics.ctaClick(label, source, "provider");
}

export function ProviderRegistrationCtaButton({
  label,
  source,
  variant = "default",
  size = "default",
  className,
  style,
}: ProviderRegistrationCtaButtonProps) {
  return (
    <Button
      nativeButton={false}
      render={<Link href={getProviderRegistrationUrl()} />}
      variant={variant}
      size={size}
      className={className}
      style={style}
      onClick={() => trackProviderRegistrationClick(label, source)}
    >
      {label}
    </Button>
  );
}

export const ProviderRegistrationCtaLink = forwardRef<HTMLAnchorElement, ProviderRegistrationCtaLinkProps>(
  function ProviderRegistrationCtaLink({ label, source, onClick, ...props }, ref) {
    return (
      <Link
        href={getProviderRegistrationUrl()}
        ref={ref}
        {...props}
        onClick={(event) => {
          trackProviderRegistrationClick(label, source);
          onClick?.(event);
        }}
      >
        {label}
      </Link>
    );
  }
);
