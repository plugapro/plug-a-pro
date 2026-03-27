create table if not exists leads (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('waitlist', 'contact', 'chat')),
  email       text not null,
  name        text,
  message     text,
  source      text,
  venture     text not null,
  created_at  timestamptz default now()
);

create index if not exists leads_venture_idx
  on leads (venture, type, created_at desc);
