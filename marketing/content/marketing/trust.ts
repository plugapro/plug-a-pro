import {
  Camera,
  ClipboardCheck,
  FileText,
  MessageCircle,
  ShieldAlert,
  Star,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { providerEconomicsContent } from "./provider-economics";
import { reviewModelContent } from "./reviews";

export type TrustEventType =
  | "PROFILE_REVIEWED"
  | "QUOTE_RECORDED"
  | "PHOTOS_ATTACHED"
  | "JOB_STATUS_UPDATED"
  | "REVIEW_COLLECTED"
  | "SUPPORT_ESCALATED";

export type TrustPackItem = {
  eventType: TrustEventType;
  icon: LucideIcon;
  title: string;
  body: string;
};

export const trustPackItems: TrustPackItem[] = [
  {
    eventType: "PROFILE_REVIEWED",
    icon: UserRoundCheck,
    title: "Profile reviewed",
    body: "Provider applications are reviewed before marketplace access. Profiles show what is recorded, supplied and approved for access.",
  },
  {
    eventType: "QUOTE_RECORDED",
    icon: FileText,
    title: "Written quote before work starts",
    body: "The price and scope are sent in writing before work begins. Extra work also needs written approval.",
  },
  {
    eventType: "PHOTOS_ATTACHED",
    icon: Camera,
    title: "Before and after photos",
    body: "Photos can be attached to the job record before and after work where the flow supports them.",
  },
  {
    eventType: "JOB_STATUS_UPDATED",
    icon: MessageCircle,
    title: "WhatsApp updates",
    body: "The job can move through WhatsApp updates without requiring either side to start with personal contact details.",
  },
  {
    eventType: "REVIEW_COLLECTED",
    icon: Star,
    title: "Reviews from completed jobs",
    body: "Provider reputation is built from completed jobs and real customer reviews.",
  },
  {
    eventType: "SUPPORT_ESCALATED",
    icon: ShieldAlert,
    title: "Support escalation",
    body: "If something goes wrong, support reviews the written quote, job history, photos and messages available in the record.",
  },
];

export const trustPageContent = {
  eyebrow: "Trust & Safety",
  title: "Trust is built from records, not broad promises",
  intro:
    "Plug A Pro helps customers make a better-informed choice with reviewed profiles, written quotes, job records, photos and support escalation.",
  accountabilityNote:
    "Providers are independent service providers responsible for their own tools, conduct, credentials and work quality. Plug A Pro provides the platform record and support process.",
  process: [
    {
      icon: ClipboardCheck,
      title: "Customer proceeds after seeing the profile",
      body: "The customer can review the provider profile before choosing whether to proceed with the job.",
    },
    {
      icon: FileText,
      title: "Scope stays written",
      body: "Quotes, approvals, extra work and close-out notes are kept in the job record.",
    },
    {
      icon: Camera,
      title: "Evidence helps support",
      body: "Photos and notes give support a starting point if either side raises a concern.",
    },
  ],
  providerEconomics: providerEconomicsContent,
  reviewModel: reviewModelContent,
} as const;
