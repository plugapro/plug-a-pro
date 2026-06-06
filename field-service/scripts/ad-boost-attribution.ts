/**
 * Attribution snapshot for the 4 June 2026 Meta boost.
 * Ad started 2026-06-04 09:51 SAST (= 07:51:00Z).
 * Read-only — reports counts since the boost start.
 */
import { db as prisma } from "../lib/db";

const BOOST_START = new Date("2026-06-04T07:51:00Z"); // 09:51 SAST

async function main() {
  const since = BOOST_START;
  console.log(`\nAd boost attribution since ${since.toISOString()} (09:51 SAST 2026-06-04)\n`);

  const [
    inboundTotal,
    inboundDistinctPhones,
    inboundByType,
    newCustomers,
    newProviders,
    newApplications,
    applicationsByStatus,
    newJobRequests,
  ] = await Promise.all([
    prisma.inboundWhatsAppMessage.count({ where: { firstSeenAt: { gte: since } } }),
    prisma.inboundWhatsAppMessage.findMany({
      where: { firstSeenAt: { gte: since } },
      select: { phone: true },
      distinct: ["phone"],
    }),
    prisma.inboundWhatsAppMessage.groupBy({
      by: ["messageType"],
      where: { firstSeenAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.customer.count({ where: { createdAt: { gte: since } } }),
    prisma.provider.count({ where: { createdAt: { gte: since } } }),
    prisma.providerApplication.count({ where: { submittedAt: { gte: since } } }),
    prisma.providerApplication.groupBy({
      by: ["status"],
      where: { submittedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.jobRequest.count({ where: { createdAt: { gte: since } } }),
  ]);

  console.log("Inbound WhatsApp");
  console.log(`  Total inbound messages : ${inboundTotal}`);
  console.log(`  Distinct phones        : ${inboundDistinctPhones.length}`);
  if (inboundByType.length) {
    console.log("  By messageType:");
    for (const row of inboundByType) {
      console.log(`    ${row.messageType.padEnd(20)} ${row._count._all}`);
    }
  }

  console.log("\nPlatform records created since ad start");
  console.log(`  New Customer rows       : ${newCustomers}`);
  console.log(`  New Provider rows       : ${newProviders}`);
  console.log(`  New ProviderApplication : ${newApplications}`);
  if (applicationsByStatus.length) {
    console.log("    By status:");
    for (const row of applicationsByStatus) {
      console.log(`      ${row.status.padEnd(12)} ${row._count._all}`);
    }
  }
  console.log(`  New JobRequest rows     : ${newJobRequests}`);

  // Last 5 inbound phone numbers (masked) for sanity check
  const recent = await prisma.inboundWhatsAppMessage.findMany({
    where: { firstSeenAt: { gte: since } },
    orderBy: { firstSeenAt: "desc" },
    take: 10,
    select: { phone: true, messageType: true, firstSeenAt: true, processedAt: true },
  });
  if (recent.length) {
    console.log("\nMost recent inbound (last 10, phone tail-4 only):");
    for (const r of recent) {
      const tail = r.phone.slice(-4);
      const ts = r.firstSeenAt.toISOString();
      const processed = r.processedAt ? "processed" : "unprocessed";
      console.log(`  ${ts}  …${tail}  ${r.messageType.padEnd(12)} ${processed}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
