-- Ещё один этап расхода: вопрос к Jev о повторе мысли между частями карточки.
--
-- Список этапов пишется целиком, вместе с чужими: ограничение одно на всю
-- таблицу, и ветка, пересоздавшая его под свой список, стирает этапы соседней —
-- у той на проде молча падает запись расхода.
alter table dailynews.model_calls
  drop constraint if exists model_calls_stage_check;

alter table dailynews.model_calls
  add constraint model_calls_stage_check check (stage = any (array[
    'score', 'digest', 'summary', 'translate', 'translation-quality',
    'video', 'voice', 'post', 'post-quality', 'interests', 'dedup',
    'spoken-terms', 'reading-gate',
    -- Своё: повтор одной мысли разными словами счётчик слов не ловит.
    'reading-repeat'
  ]));

insert into dailynews.migrations (name) values ('0057_model_calls_reading_repeat') on conflict (name) do nothing;
