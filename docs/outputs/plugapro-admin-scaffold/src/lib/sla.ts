// SLA registry. Single source of truth for queue targets.
// Mirrors what the Operations dashboard displays per tile.

export type QueueType =
  | 'VALIDATION'
  | 'DISPATCH'
  | 'FIELD'
  | 'QUOTES'
  | 'FINANCE'
  | 'TRUST'
  | 'SUPPLY';

export interface SlaTarget {
  queue: QueueType;
  label: string;
  targetSeconds: number;  // Hard SLA.
  warnSeconds: number;    // UI shows amber at this threshold.
}

export const SLA_TARGETS: Record<QueueType, SlaTarget> = {
  VALIDATION: { queue: 'VALIDATION', label: 'Triage inside 30 min',   targetSeconds: 30 * 60,      warnSeconds: 20 * 60      },
  DISPATCH:   { queue: 'DISPATCH',   label: 'Assign inside 15 min',   targetSeconds: 15 * 60,      warnSeconds: 10 * 60      },
  FIELD:      { queue: 'FIELD',      label: 'Triage inside 1 hour',   targetSeconds: 60 * 60,      warnSeconds: 45 * 60      },
  QUOTES:     { queue: 'QUOTES',     label: 'Chase inside 1 hour',    targetSeconds: 60 * 60,      warnSeconds: 45 * 60      },
  FINANCE:    { queue: 'FINANCE',    label: 'Resolve inside 1 day',   targetSeconds: 24 * 60 * 60, warnSeconds: 18 * 60 * 60 },
  TRUST:      { queue: 'TRUST',      label: 'Acknowledge inside 2 hours', targetSeconds: 2 * 60 * 60, warnSeconds: 90 * 60 },
  SUPPLY:     { queue: 'SUPPLY',     label: 'Review inside 1 day',    targetSeconds: 24 * 60 * 60, warnSeconds: 18 * 60 * 60 },
};

export function slaFor(queue: QueueType): SlaTarget {
  return SLA_TARGETS[queue];
}

export type SlaHealth = 'ok' | 'warn' | 'breached';

export function slaHealth(opened: Date, queue: QueueType, now: Date = new Date()): SlaHealth {
  const elapsed = (now.getTime() - opened.getTime()) / 1000;
  const { targetSeconds, warnSeconds } = slaFor(queue);
  if (elapsed >= targetSeconds) return 'breached';
  if (elapsed >= warnSeconds) return 'warn';
  return 'ok';
}
