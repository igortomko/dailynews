-- dailynews: схема и роль.
-- Шаблон из team-документа «Инфраструктура: Supabase и VPS, правила для агентов».
-- Применять через Supabase MCP apply_migration или SQL Editor ролью postgres.
-- Пароль роли ставит владелец отдельно, в миграции его нет.

create schema if not exists dailynews;

do $$ begin
  create role dailynews_bot with login;
exception when duplicate_object then null;
end $$;

grant dailynews_bot to postgres;   -- нужно для default privileges ниже

grant usage, create on schema dailynews to dailynews_bot;
alter default privileges for role postgres in schema dailynews
  grant select, insert, update, delete on tables to dailynews_bot;
alter default privileges for role postgres in schema dailynews
  grant usage, select on sequences to dailynews_bot;

grant usage on schema dailynews to products_reader;
alter default privileges for role postgres in schema dailynews
  grant select on tables to products_reader;
alter default privileges for role dailynews_bot in schema dailynews
  grant select on tables to products_reader;

revoke all on schema public from dailynews_bot;

-- search_path прибит к своей схеме; extensions добавлен ради pg_trgm,
-- создание объектов всё равно попадает в dailynews — она первая в списке.
alter role dailynews_bot set search_path = dailynews, extensions;
alter role dailynews_bot connection limit 10;

create extension if not exists pg_trgm with schema extensions;

-- Свой журнал миграций в своей схеме: общий supabase_migrations не трогаем.
create table if not exists dailynews.migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
insert into dailynews.migrations (name) values ('0001_schema_and_role')
  on conflict (name) do nothing;
