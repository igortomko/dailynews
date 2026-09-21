-- Additive: old releases continue reading the plain-text summary.
alter table dailynews.items add column if not exists source_content_kind text
  check (source_content_kind in ('article_text', 'feed_text'));
alter table dailynews.digest_items
  add column if not exists summary_document jsonb;
alter table dailynews.readers
  add column if not exists reading_v2_enabled boolean not null default false;
update dailynews.readers set reading_v2_enabled = true
 where owner or (select count(*) from dailynews.readers) < 10;

create table if not exists dailynews.article_analyses (
  cache_key text primary key,
  item_id bigint not null references dailynews.items(id) on delete cascade,
  source_version text not null,
  result jsonb,
  lease_token text,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists dailynews.reader_summaries (
  reader_id bigint not null references dailynews.readers(id) on delete cascade,
  cache_key text not null,
  item_id bigint not null references dailynews.items(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (reader_id, cache_key)
);
create table if not exists dailynews.reading_calls (
  id text primary key,
  reader_id bigint not null references dailynews.readers(id) on delete cascade,
  phase text not null,
  model text not null,
  reserved_usd numeric not null check (reserved_usd >= 0),
  status text not null check (status in ('reserved', 'settled', 'uncertain')),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cached_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  cost_usd numeric,
  latency_ms integer,
  at timestamptz not null default now()
);
create index if not exists reading_calls_reader_day_idx on dailynews.reading_calls(reader_id, at);
create index if not exists reader_summaries_item_idx on dailynews.reader_summaries(reader_id, item_id);

-- Explicit grants complement the schema's default privileges.
grant select, insert, update, delete on dailynews.article_analyses, dailynews.reader_summaries, dailynews.reading_calls to dailynews_bot;
revoke all on dailynews.article_analyses, dailynews.reader_summaries, dailynews.reading_calls from public;
alter table dailynews.article_analyses enable row level security;
alter table dailynews.reader_summaries enable row level security;
alter table dailynews.reading_calls enable row level security;
drop policy if exists reading_analysis_runtime on dailynews.article_analyses;
create policy reading_analysis_runtime on dailynews.article_analyses for all to dailynews_bot using (true) with check (true);
drop policy if exists reading_summary_runtime on dailynews.reader_summaries;
create policy reading_summary_runtime on dailynews.reader_summaries for all to dailynews_bot using (true) with check (true);
drop policy if exists reading_calls_runtime on dailynews.reading_calls;
create policy reading_calls_runtime on dailynews.reading_calls for all to dailynews_bot using (true) with check (true);

insert into dailynews.migrations (name) values ('0044_generative_reading') on conflict (name) do nothing;
