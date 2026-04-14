// ─── GET /api/customer/services/[serviceId] ────────────────────────────────────
// Service model removed — returns static category info based on category slug.
// No auth required.

import { NextResponse } from 'next/server'

const CATEGORIES: Record<string, { name: string; description: string }> = {
  plumbing:   { name: 'Plumbing',       description: 'Leaks, installations, drain clearing and more.' },
  painting:   { name: 'Painting',       description: 'Interior and exterior painting services.' },
  garden:     { name: 'Garden',         description: 'Lawn care, landscaping, and tree trimming.' },
  handyman:   { name: 'Handyman',       description: 'General repairs and odd jobs around the home.' },
  appliances: { name: 'Appliances',     description: 'Repairs and installation of home appliances.' },
  electrical: { name: 'Electrical',     description: 'Wiring, fault-finding, and compliance certificates.' },
  diy:        { name: 'DIY & Assembly', description: 'Flat-pack assembly, shelving, and mounting.' },
  roofing:    { name: 'Roofing',        description: 'Roof repairs, waterproofing, and inspections.' },
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ serviceId: string }> }
) {
  const { serviceId: slug } = await params

  const category = CATEGORIES[slug]
  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  return NextResponse.json({
    slug,
    name: category.name,
    description: category.description,
  })
}
