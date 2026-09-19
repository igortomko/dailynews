-- Время выпуска и часовой пояс. Раньше час был прибит к расписанию cron
-- в воркфлоу: поменять его значило править файл и делать коммит.
--
-- Теперь cron ходит каждый час, а прогон сам решает, его ли это час
-- в часовом поясе читателя. Стоит это ничего: проверка часа — один запрос
-- к базе, всё остальное не начинается.
alter table dailynews.profile
  add column if not exists digest_hour smallint not null default 7
    check (digest_hour between 0 and 23),
  add column if not exists timezone text not null default 'America/Sao_Paulo';

insert into dailynews.migrations (name) values ('0015_schedule')
  on conflict (name) do nothing;
