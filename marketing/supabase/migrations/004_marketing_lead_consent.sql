-- Capture the exact consent disclosure accepted before a WhatsApp handoff.
-- The marketing app inserts through the server-side service-role client; public
-- browser clients should not read or write this table directly.

alter table marketing_leads
  add column if not exists consent_text text,
  add column if not exists consent_text_version text,
  add column if not exists consent_source text,
  add column if not exists consent_accepted_at timestamptz;

alter table marketing_leads enable row level security;

drop policy if exists marketing_leads_no_public_access on marketing_leads;

create policy marketing_leads_no_public_access
  on marketing_leads
  for all
  to anon, authenticated
  using (false)
  with check (false);
