// POST /api/technician/jobs/[id]/photo
// Body: multipart/form-data with `files[]` or `file`, optional `caption`, and optional `label`.
// Uploads to Vercel Blob and creates Attachment records in DB.

import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { getProviderPhotoRouteErrorMessage } from '@/lib/provider-action-errors'
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

  const files = formData.getAll('files')
  const fallbackFile = formData.get('file')
  const label = formData.get('label')
  const caption = String(formData.get('caption') ?? '').trim() || null

  const uploads = files.length > 0 ? files : fallbackFile ? [fallbackFile] : []

  if (uploads.length === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  for (const upload of uploads) {
    if (!(upload instanceof File)) {
      return NextResponse.json({ error: 'Invalid upload payload' }, { status: 400 })
    }

    if (!upload.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image files are allowed' },
        { status: 400 }
      )
    }

    if (upload.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      )
    }
  }

  const labelValue =
    label === 'before' || label === 'after' || label === 'evidence' ? label : 'evidence'

  try {
    const attachments = []

    for (const upload of uploads) {
      const file = upload as File
      const url = await uploadJobPhoto({
        jobId,
        file,
        label: labelValue,
        caption,
        uploadedBy: session.id,
      })

      const attachment = await db.attachment.findFirst({
        where: { jobId, url },
        select: { id: true, caption: true, label: true },
      })

      attachments.push({
        id: attachment?.id ?? null,
        proxyUrl: attachment?.id ? `/api/attachments/${attachment.id}` : null,
        caption: attachment?.caption ?? caption,
        label: attachment?.label ?? labelValue,
      })
    }

    return NextResponse.json({
      attachments,
    })
  } catch (err) {
    return NextResponse.json(
      { error: getProviderPhotoRouteErrorMessage(err) },
      { status: 422 },
    )
  }
}
