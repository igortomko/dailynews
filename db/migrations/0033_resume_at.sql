-- Отложенное возвращение.
--
-- «Продолжить» отвечает не только тот, кто вернулся: читатель может уехать
-- и попросить ленту через неделю. Дата возврата хранится отдельно от паузы —
-- пауза говорит «не пишем», а эта колонка «до какого числа».
alter table dailynews.readers
  add column if not exists resume_at timestamptz;

insert into dailynews.migrations (name) values ('0033_resume_at')
  on conflict (name) do nothing;
