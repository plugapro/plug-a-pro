"use client";

import { useEffect } from "react";
import { analytics } from "@/lib/analytics";

const SECTIONS = [
  { id: "section-hero", name: "hero" },
  { id: "section-how-it-works", name: "how_it_works" },
  { id: "section-problem", name: "problem_statement" },
  { id: "section-who-its-for", name: "who_its_for" },
  { id: "section-trust", name: "trust_safety" },
  { id: "section-operating-model", name: "operating_model" },
  { id: "section-features", name: "features" },
  { id: "section-social-proof", name: "social_proof" },
  { id: "section-cta", name: "cta_strip" },
] as const;

/**
 * Fires a `section_view` event the first time each section enters the viewport.
 * Renders nothing - pure side-effect component.
 */
export function SectionTracker() {
  useEffect(() => {
    const seen = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          if (seen.has(id)) continue;
          seen.add(id);
          const section = SECTIONS.find((s) => s.id === id);
          if (section) analytics.sectionView(section.name);
        }
      },
      { threshold: 0.3 }
    );

    for (const { id } of SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return null;
}
