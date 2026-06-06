'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { crudAction } from '@/lib/crud-action'
import { issueProviderResumeToken } from '@/lib/provider-resume-tokens'

const Input = z.object({ conversationId: z.string().min(1) })

export async function generateResumeLinkAction(
  input: z.infer<typeof Input>,
): Promise<{ ok: true; url: string }> {
  const result = await crudAction({
    input,
    schema: Input,
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: 'admin.applications.resume_link_button',
    entity: 'ProviderResumeToken',
    action: 'resume_link.generate',
    run: async (validInput, tx) => {
      const session = await getSession()
      if (!session) throw new Error('no_session')

      const admin = await tx.adminUser.findUniqueOrThrow({
        where: { userId: session.id },
      })

      const conv = await tx.conversation.findUnique({
        where: { id: validInput.conversationId },
      })
      if (!conv) throw new Error('conversation_not_found')
      if (conv.flow !== 'registration') {
        throw new Error(
          `not_in_registration_flow: conversation ${conv.id} is in flow '${conv.flow}'`,
        )
      }

      const { rawToken } = await issueProviderResumeToken(tx, {
        conversationId: conv.id,
        phone: conv.phone,
        issuedByAdminUserId: admin.id,
        source: 'recovery_nudge',
      })

      const baseUrl = (process.env.APP_URL ?? 'https://plugapro.co.za').replace(/\/$/, '')
      const url = `${baseUrl}/provider/signup?t=${rawToken}`

      revalidatePath('/admin/applications')
      return { ok: true as const, url }
    },
  })
  return result.data
}
