// POST /api/technician/jobs/[id]/photo
// Body: multipart/form-data with `file` (image) and `label` ("before" | "after")
// Uploads to Vercel Blob and creates an Attachment record in DB.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { uploadJobPhoto } from '@/lib/storage'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session || session.role !== 'provider') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: jobId } = await params

  // Verify provider owns this job
  const provider = await db.provider.findUnique({ where: { userId: session.id } })
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 403 })
  }

  const job = await db.job.findUnique({ where: { id: jobId } })
  if (!job || job.providerId !== provider.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Parse multipart form data
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const label = formData.get('label')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!file.type.startsWith('image/')) {
    return NextResponse.json(
      { error: 'Only image files are allowed' },
      { status: 400 }
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: 'File too large. Maximum size is 10MB.' },
      { status: 400 }
    )
  }

  const labelValue =
    label === 'before' || label === 'after' ? label : undefined

  try {
    const url = await uploadJobPhoto({
      jobId,
      file,
      label: labelValue,
      uploadedBy: session.id,
    })

    // Fetch the newly created attachment to get its id
    const attachment = await db.attachment.findFirst({
      where: { jobId, url },
      select: { id: true },
    })

    return NextResponse.json({
      url,
      id: attachment?.id ?? null,
      proxyUrl: attachment ? `/api/attachments/${attachment.id}` : url,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
