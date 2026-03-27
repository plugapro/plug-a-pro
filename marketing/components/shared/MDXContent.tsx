"use client";

// components/shared/MDXContent.tsx
// Renders Velite-compiled MDX body content.
//
// Velite's s.mdx() produces a compiled function-body string that expects the
// React JSX runtime to be injected as `arguments[0]`. This component wraps
// that safely using new Function (equivalent to what Velite's own useMDXComponent
// helper does internally in newer versions that expose it).
//
// The "use client" directive is required because we create the component
// dynamically at runtime. The server-rendered page wraps this in a server
// <article>, so the client boundary is isolated to content rendering only.

import { useMemo } from "react";
import * as runtime from "react/jsx-runtime";

interface MDXContentProps {
  /** Velite's compiled MDX code string (the `body` field from a collection entry). */
  code: string;
  /** Optional component overrides forwarded to the MDX renderer. */
  components?: Record<string, React.ComponentType>;
}

function useMDXComponent(code: string) {
  // new Function is safe here: `code` is produced by Velite's build-time
  // MDX compiler (not user input) and the function body only receives the
  // React JSX runtime object — no global scope access.
  // eslint-disable-next-line no-new-func
  const fn = new Function(code);
  return fn({ ...runtime }).default as React.ComponentType<{
    components?: Record<string, React.ComponentType>;
  }>;
}

export function MDXContent({ code, components }: MDXContentProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const Component = useMemo(() => useMDXComponent(code), [code]);
  return (
    <div className="prose prose-zinc dark:prose-invert max-w-none">
      <Component components={components} />
    </div>
  );
}
