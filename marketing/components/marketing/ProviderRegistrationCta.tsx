"use client";

import Link from "next/link";
import type { CSSProperties, MouseEvent } from "react";
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
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

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

export function ProviderRegistrationCtaLink({
  label,
  source,
  className,
  onClick,
}: ProviderRegistrationCtaLinkProps) {
  return (
    <Link
      href={getProviderRegistrationUrl()}
      className={className}
      onClick={(event) => {
        trackProviderRegistrationClick(label, source);
        onClick?.(event);
      }}
    >
      {label}
    </Link>
  );
}
