# Plug A Pro Marketing Site — Visual Direction

Decided: 2026-03-27

## Icon System: Lucide React

**Decision:** Replace all emoji service icons with Lucide React components.

**Rationale:**
- `lucide-react` was already installed (^1.6.0) — no new dependency
- Lucide icons are consistent in weight, size, and style
- They render cleanly at any DPI, support theming via CSS color, and look professional in dark/light mode
- Emoji rendering is inconsistent across platforms and OS versions

**Service category icon mapping:**

| Category | Lucide Icon |
|----------|-------------|
| Plumbing & Drainage | `Wrench` |
| Electrical | `Zap` |
| HVAC & Refrigeration | `Wind` |
| General Home Maintenance | `Home` |
| Locksmith & Security | `Lock` |
| DIY Project Help | `Hammer` |

**Feature icon mapping:**

| Feature | Lucide Icon |
|---------|-------------|
| WhatsApp Booking | `MessageCircle` |
| Smart Dispatch | `Navigation` |
| Technician PWA | `Smartphone` |
| Auto-Invoicing | `FileText` |
| Extra Work Approval | `ClipboardCheck` |
| Before & After Photos | `Camera` |

**Problem statement icon mapping:**

| Problem | Lucide Icon |
|---------|-------------|
| Jobs in WhatsApp groups | `ClipboardList` |
| Phone dispatch | `Phone` |
| Excel invoicing | `FileSpreadsheet` |
| No technician status | `MapPin` |

## Icon Container Style

Service cards use a consistent icon container:
```tsx
<div className="size-10 rounded-xl flex items-center justify-center bg-muted">
  <Icon className="size-5" style={{ color: "var(--accent-brand)" }} aria-hidden="true" />
</div>
```

## Background Treatment

Hero section uses a subtle dot-grid CSS background:
- `radial-gradient(circle, var(--border) 1px, transparent 1px)`
- `backgroundSize: "28px 28px"`
- Opacity: 0.04 (light) / 0.07 (dark)

## Photos / Illustrations

No external photos or illustrations added in this update. Design relies on:
- Typography and spacing hierarchy
- Lucide icons for visual anchors
- Subtle CSS background treatment in Hero
- Consistent border/muted treatments for cards

This avoids stock photo feel, keeps dependencies lean, and maintains fast load times.

## What Needs Human Review

- Hero dot-grid background: verify in both light and dark mode
- Consider adding a hero image or illustration in a future design sprint
- Confirm icon choices look correct on mobile
