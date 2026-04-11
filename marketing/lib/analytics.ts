/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Typed wrapper around gtag so every event call is discoverable and consistent.
 * Safe to call in SSR contexts — guards on typeof window/gtag.
 */
function track(event: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as typeof window & { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag !== "function") return;
  w.gtag("event", event, params);
}

export const analytics = {
  /** CTA button clicked — primary conversion intent signal */
  ctaClick(label: string, location: string, audience: "customer" | "worker" | "provider") {
    track("cta_click", { label, location, audience });
  },

  /** A page section became visible (30% threshold) */
  sectionView(sectionName: string) {
    track("section_view", { section_name: sectionName });
  },

  /** User scrolled to a milestone depth */
  scrollDepth(depth: 25 | 50 | 75 | 100) {
    track("scroll_depth", { depth, value: depth });
  },

  /** WhatsApp chat link clicked */
  whatsappClick(source: string) {
    track("whatsapp_click", { source });
  },

  /** Lead magnet form submitted — phone captured, WhatsApp handoff triggered */
  leadMagnetDownload(magnet: "template-pack" | "dispatch-checklist" | "cashflow-tracker", source: string) {
    track("lead_magnet_download", { magnet, source });
  },

  /** Chat widget toggled open */
  chatOpen() {
    track("chat_widget_open");
  },

  /** Message sent in the chat widget */
  chatMessageSent() {
    track("chat_message_sent");
  },

  /** Navigation link clicked */
  navClick(label: string, destination: string) {
    track("nav_click", { label, destination });
  },

  /** "How it works" detail link clicked */
  howItWorksClick(source: string) {
    track("how_it_works_click", { source });
  },

  /** Job category card clicked in Who It's For */
  jobCategoryClick(category: string) {
    track("job_category_click", { category });
  },
};
