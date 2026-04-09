alter table leads
  drop constraint if exists leads_type_check;

alter table leads
  add constraint leads_type_check
  check (type in ('waitlist', 'contact', 'chat', 'onboarding'));

alter table leads
  alter column email drop not null;

alter table leads
  add column if not exists phone text,
  add column if not exists journey text,
  add column if not exists business_name text,
  add column if not exists city text,
  add column if not exists service_category text,
  add column if not exists whatsapp_opt_in boolean not null default false;

create index if not exists leads_phone_idx
  on leads (phone);
