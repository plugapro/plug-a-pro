/**
 * Per-phone drop-off map for the 4 June 2026 Meta boost.
 * Read-only — pulls the Conversation state + application status for every
 * inbound phone since the ad started.
 */
import { db as prisma } from "../lib/db";

const BOOST_START = new Date("2026-06-04T07:51:00Z"); // 09:51 SAST

function tail(p: string) {
  return p.slice(-4);
}

async function main() {
  const inbound = await prisma.inboundWhatsAppMessage.findMany({
    where: { firstSeenAt: { gte: BOOST_START } },
    orderBy: { firstSeenAt: "asc" },
    select: {
      phone: true,
      messageType: true,
      firstSeenAt: true,
      lastSeenAt: true,
      processedAt: true,
      failureReason: true,
    },
  });

  // Group by phone
  const byPhone = new Map<
    string,
    {
      first: Date;
      last: Date;
      count: number;
      types: Map<string, number>;
      unprocessed: number;
      failures: string[];
    }
  >();
  for (const row of inbound) {
    const slot =
      byPhone.get(row.phone) ?? {
        first: row.firstSeenAt,
        last: row.firstSeenAt,
        count: 0,
        types: new Map<string, number>(),
        unprocessed: 0,
        failures: [],
      };
    slot.count += 1;
    if (row.firstSeenAt < slot.first) slot.first = row.firstSeenAt;
    if (row.firstSeenAt > slot.last) slot.last = row.firstSeenAt;
    slot.types.set(row.messageType, (slot.types.get(row.messageType) ?? 0) + 1);
    if (!row.processedAt) slot.unprocessed += 1;
    if (row.failureReason) slot.failures.push(row.failureReason);
    byPhone.set(row.phone, slot);
  }

  const phones = [...byPhone.keys()];
  // InboundWhatsAppMessage stores phones without "+", everything else stores E.164 with "+".
  const e164 = phones.map((p) => (p.startsWith("+") ? p : `+${p}`));
  const e164ByRaw = new Map(phones.map((p, i) => [p, e164[i]]));
  const rawByE164 = new Map(e164.map((p, i) => [p, phones[i]]));

  // Pull Conversation + Application + Provider for those phones in one go each.
  const [conversations, applications, providers, intakes] = await Promise.all([
    prisma.conversation.findMany({
      where: { phone: { in: e164 } },
      select: {
        phone: true,
        flow: true,
        step: true,
        data: true,
        updatedAt: true,
        expiresAt: true,
        isTestSession: true,
      },
    }),
    prisma.providerApplication.findMany({
      where: { phone: { in: e164 }, submittedAt: { gte: BOOST_START } },
      select: {
        phone: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        name: true,
        isTestUser: true,
      },
    }),
    prisma.provider.findMany({
      where: { phone: { in: e164 }, createdAt: { gte: BOOST_START } },
      select: { phone: true, createdAt: true, active: true, status: true, name: true },
    }),
    prisma.onboardingIntake.findMany({
      where: { phone: { in: e164 }, createdAt: { gte: BOOST_START } },
      select: { phone: true, journey: true, status: true, source: true, createdAt: true },
    }),
  ]);

  // All downstream maps key by RAW phone (no +) so they line up with byPhone.
  const convByPhone = new Map(
    conversations.map((c) => [rawByE164.get(c.phone) ?? c.phone, c]),
  );
  const appByPhone = new Map(
    applications.map((a) => [rawByE164.get(a.phone) ?? a.phone, a]),
  );
  const provByPhone = new Map(
    providers.map((p) => [rawByE164.get(p.phone) ?? p.phone, p]),
  );
  const intakeByPhone = new Map(
    intakes.map((i) => [rawByE164.get(i.phone) ?? i.phone, i]),
  );
  void e164ByRaw;

  console.log(`\nDrop-off map — ${phones.length} distinct phones since boost start\n`);

  // Build per-phone summary, ordered by last activity desc
  const summary = phones.map((phone) => {
    const stats = byPhone.get(phone)!;
    const conv = convByPhone.get(phone);
    const app = appByPhone.get(phone);
    const prov = provByPhone.get(phone);
    const intake = intakeByPhone.get(phone);
    const sessionAgeMin = conv ? (Date.now() - conv.updatedAt.getTime()) / 60000 : null;
    const sessionExpired = conv ? conv.expiresAt.getTime() < Date.now() : null;
    return { phone, stats, conv, app, prov, intake, sessionAgeMin, sessionExpired };
  });
  summary.sort((a, b) => b.stats.last.getTime() - a.stats.last.getTime());

  for (const s of summary) {
    const flowStep = s.conv ? `${s.conv.flow}/${s.conv.step}` : "no conversation row";
    const test = s.conv?.isTestSession ? " [TEST]" : "";
    const outcome = s.app
      ? `APPLIED:${s.app.status}${s.app.isTestUser ? " (TEST)" : ""}`
      : s.intake
        ? `INTAKE:${s.intake.status}/${s.intake.journey}`
        : "no application";
    const sessionAge = s.sessionAgeMin == null ? "—" : `${s.sessionAgeMin.toFixed(0)}m ago`;
    const expiredFlag = s.sessionExpired ? " EXPIRED" : "";
    const typesStr = [...s.stats.types.entries()]
      .map(([t, n]) => `${t}:${n}`)
      .join(" ");
    const unprocFlag = s.stats.unprocessed > 0 ? ` !${s.stats.unprocessed}unproc` : "";
    console.log(
      `…${tail(s.phone)}  msgs=${s.stats.count.toString().padStart(3)}${unprocFlag}  last=${sessionAge}${expiredFlag}  flow=${flowStep}${test}  → ${outcome}  [${typesStr}]`,
    );
  }

  // Aggregate drop-off by step
  console.log("\nDrop-off by current Conversation step (phones with NO application)");
  const stuck = summary.filter((s) => !s.app);
  const byStep = new Map<string, number>();
  for (const s of stuck) {
    const key = s.conv ? `${s.conv.flow}/${s.conv.step}` : "no_conversation_row";
    byStep.set(key, (byStep.get(key) ?? 0) + 1);
  }
  const stepRows = [...byStep.entries()].sort((a, b) => b[1] - a[1]);
  for (const [step, n] of stepRows) {
    console.log(`  ${step.padEnd(40)} ${n}`);
  }

  // Session expired vs active among stuck
  const expired = stuck.filter((s) => s.sessionExpired).length;
  const active = stuck.filter((s) => s.conv && !s.sessionExpired).length;
  const noConv = stuck.filter((s) => !s.conv).length;
  console.log("\nSession state among stuck phones");
  console.log(`  Active (within 30m TTL) : ${active}`);
  console.log(`  Expired (>30m idle)     : ${expired}`);
  console.log(`  No conversation row     : ${noConv}`);

  // Snapshot session data for the stuck phones (keys only, not values, to keep PII out)
  console.log("\nSession data keys captured for each stuck phone (no values)");
  for (const s of stuck) {
    if (!s.conv) continue;
    const data = s.conv.data as Record<string, unknown> | null;
    const keys = data ? Object.keys(data) : [];
    console.log(`  …${tail(s.phone)}  ${s.conv.flow}/${s.conv.step}  keys=[${keys.join(",")}]`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
