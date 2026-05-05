alter table marketing_leads
  drop constraint if exists marketing_leads_type_check;

alter table marketing_leads
  add constraint marketing_leads_type_check
  check (type in ('waitlist', 'contact', 'chat', 'onboarding'));

alter table marketing_leads
  alter column email drop not null;

alter table marketing_leads
  add column if not exists phone text,
  add column if not exists journey text,
  add column if not exists business_name text,
  add column if not exists city text,
  add column if not exists service_category text,
  add column if not exists whatsapp_opt_in boolean not null default false;

create index if not exists marketing_leads_phone_idx
  on marketing_leads (phone);
