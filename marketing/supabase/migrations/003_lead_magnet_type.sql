-- 003_lead_magnet_type.sql
-- Extend marketing_leads type constraint to include lead_magnet captures.

alter table marketing_leads
  drop constraint if exists marketing_leads_type_check;

alter table marketing_leads
  add constraint marketing_leads_type_check
  check (type in ('waitlist', 'contact', 'chat', 'onboarding', 'lead_magnet'));
