-- Вопрос «о чём этому человеку читать» — такой же оплаченный вызов.
--
-- Этап, которого нет в ограничении, роняет запись о расходе целиком:
-- вызов оплачен, а в model_calls его нет, и дневной потолок считает
-- не те деньги. Так ломалось с переводом статьи (0027) и с расшифровкой
-- ролика (0035). Здесь то же самое с `interests`: вопрос Jev при заведении
-- читателя идёт из after() после ответа боту, и упавшая вставка не роняет
-- ни вход, ни онбординг — её просто нет.
--
-- Список — объединение, а не список этой ветки. Ограничение одно на всех,
-- а пересоздаётся оно под тем же именем в каждой ветке, которая заводит
-- свой этап: взять сюда только свои значения значит стереть чужие вместе
-- с их строками — `add constraint` проверяет уже лежащие данные и падает
-- на них. В живой базе на 19 сентября 2026 уже разрешены voice, post
-- и post-quality; их миграции ещё не в main, и потерять их нельзя.
alter table dailynews.model_calls drop constraint if exists model_calls_stage_check;
alter table dailynews.model_calls
  add constraint model_calls_stage_check
  check (stage in (
    'score', 'digest', 'summary', 'translate', 'translation-quality',
    'video', 'voice', 'post', 'post-quality',
    'interests'
  ));

insert into dailynews.migrations (name) values ('0036_interests_stage')
  on conflict (name) do nothing;
