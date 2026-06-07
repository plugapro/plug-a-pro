type SupabaseAuthUser = {
  id: string
}

type SupabaseAdminClient = {
  auth: {
    admin: {
      createUser: (attributes: {
        phone: string
        phone_confirm: true
        user_metadata: Record<string, unknown>
      }) => Promise<{
        data: { user: SupabaseAuthUser | null } | null
        error: unknown
      }>
    }
  }
}

type AuthLookupClient = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}

type AuthUserRow = {
  id: string
  phone: string | null
  raw_user_meta_data: unknown
}

type ProviderApprovalAuthUserInput = {
  db: AuthLookupClient
  supabase: SupabaseAdminClient
  phone: string
  name: string
  providerId?: string | null
}

type ProviderApprovalAuthUserResult = {
  userId: string
  source: 'created' | 'existing'
}

function supabaseAuthPhone(phone: string) {
  return phone.startsWith('+') ? phone.slice(1) : phone
}

function errorField(error: unknown, field: 'code' | 'message' | 'status') {
  if (!error || typeof error !== 'object' || !(field in error)) return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function isPhoneExistsError(error: unknown) {
  const code = errorField(error, 'code')?.toLowerCase()
  const message = errorField(error, 'message')?.toLowerCase() ?? ''
  return code === 'phone_exists' || message.includes('phone number already registered')
}

async function findExistingAuthUserByPhone(db: AuthLookupClient, phone: string) {
  const authPhone = supabaseAuthPhone(phone)
  const rows = await db.$queryRaw<AuthUserRow[]>`
    select id, phone, raw_user_meta_data
    from auth.users
    where phone in (${authPhone}, ${phone})
    order by
      case when phone = ${authPhone} then 0 else 1 end,
      updated_at desc
    limit 1
  `

  return rows[0] ?? null
}

export async function createOrResolveProviderApprovalAuthUser(
  input: ProviderApprovalAuthUserInput,
): Promise<ProviderApprovalAuthUserResult> {
  const authPhone = supabaseAuthPhone(input.phone)
  const { data, error } = await input.supabase.auth.admin.createUser({
    phone: authPhone,
    phone_confirm: true,
    user_metadata: {
      role: 'provider',
      name: input.name,
      ...(input.providerId ? { providerId: input.providerId } : {}),
    },
  })

  if (!error && data?.user) {
    return {
      userId: data.user.id,
      source: 'created',
    }
  }

  if (isPhoneExistsError(error)) {
    const existingUser = await findExistingAuthUserByPhone(input.db, input.phone)
    if (existingUser?.id) {
      return {
        userId: existingUser.id,
        source: 'existing',
      }
    }
  }

  if (error || !data?.user) {
    throw new Error('Supabase user creation failed')
  }

  return {
    userId: data.user.id,
    source: 'created',
  }
}
