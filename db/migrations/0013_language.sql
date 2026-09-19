-- Язык дайджеста. До сих пор он был зашит в промпт словом «по-русски»:
-- переключатель без этого поля менял бы подпись, а не текст.
alter table dailynews.profile
  add column if not exists language text not null default 'ru'
  check (language in ('ru', 'en', 'pt'));

insert into dailynews.migrations (name) values ('0013_language')
  on conflict (name) do nothing;
