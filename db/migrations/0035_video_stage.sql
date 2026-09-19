-- Расшифровка ролика — такой же оплаченный вызов, как дайджест.
--
-- Этап, которого нет в ограничении, роняет запись о расходе целиком,
-- а с ней и сам шаг: конспект уже оплачен, но в model_calls его нет,
-- и дневной потолок считает не те деньги. Ровно так это уже ломалось
-- с переводом статьи (0027).
alter table dailynews.model_calls drop constraint if exists model_calls_stage_check;
alter table dailynews.model_calls
  add constraint model_calls_stage_check
  check (stage in ('score', 'digest', 'summary', 'translate', 'translation-quality', 'video'));

insert into dailynews.migrations (name) values ('0035_video_stage')
  on conflict (name) do nothing;
