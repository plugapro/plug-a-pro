import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

async function main() {
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.locationNode.findMany({ orderBy: [{ nodeType: 'asc' }, { slug: 'asc' }] })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outDir = process.env.LOCATION_EXPORT_DIR || path.join(process.cwd(), 'backups', 'locations')
    await mkdir(outDir, { recursive: true })
    const filePath = path.join(outDir, `location-nodes-${timestamp}.json`)
    await writeFile(filePath, JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, rows }, null, 2))
    console.log(JSON.stringify({ exported: rows.length, filePath }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('[export:locations] failed', error)
  process.exit(1)
})
