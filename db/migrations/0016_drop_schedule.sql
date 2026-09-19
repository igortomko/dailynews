-- Расписание остаётся в cron: настройка часа и пояса не понадобилась.
-- Колонки убираются сразу, а не оставляются «на всякий случай»: поле,
-- которое ничего не делает, следующий читатель кода примет за работающее.
alter table dailynews.profile
  drop column if exists digest_hour,
  drop column if exists timezone;

insert into dailynews.migrations (name) values ('0016_drop_schedule')
  on conflict (name) do nothing;
