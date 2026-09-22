-- Новый этап расхода: дешёвый привратник перед дорогой сверкой разбора.
--
-- Список этапов перечисляется целиком, вместе с чужими, а не только своим
-- новым: ограничение одно на всю таблицу, и ветка, пересоздавшая его под
-- собственный список, стирает этапы соседней — у той на проде молча падает
-- запись расхода, а `add constraint` падает на её же строках.
--
-- Старое ограничение снимается и ставится заново, потому что check нельзя
-- расширить на месте. Имя то же: под другим именем в базе осталось бы два,
-- и запись проходила бы только через пересечение списков.
alter table dailynews.model_calls
  drop constraint if exists model_calls_stage_check;

alter table dailynews.model_calls
  add constraint model_calls_stage_check check (stage = any (array[
    'score', 'digest', 'summary', 'translate', 'translation-quality',
    'video', 'voice', 'post', 'post-quality', 'interests', 'dedup',
    'spoken-terms',
    -- Своё: вопрос к Jev, решающий, звать ли дорогую сверку документа.
    'reading-gate'
  ]));
