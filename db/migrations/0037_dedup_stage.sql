-- Дедуп научился спрашивать Jev про серую зону, и у него появился свой расход.
-- Без своего этапа он писался бы как 'score' и смешался бы с оценкой потока:
-- ряд по дням перестал бы отвечать на «сколько стоит дедуп».
--
-- Список этапов пишется целиком, вместе с чужими. Переопределение под тем же
-- именем не видно ни одной проверке формы схемы, и ветка, перечислившая
-- только своё, молча гасит соседям запись расхода на живой базе.
-- На 20 сентября 2026 в живом ограничении разрешены score, digest, summary,
-- translate, translation-quality, video, voice, post, post-quality, interests.
alter table dailynews.model_calls drop constraint if exists model_calls_stage_check;
alter table dailynews.model_calls
  add constraint model_calls_stage_check
  check (stage in (
    'score', 'digest', 'summary', 'translate', 'translation-quality',
    'video', 'voice', 'post', 'post-quality',
    'interests', 'dedup'
  ));

-- Отметка о заданном вопросе. Дедуп берёт всё окно свежести, а не только
-- вставленное этим прогоном: иначе упавший между вставкой и дедупом прогон
-- оставил бы материалы непроверенными навсегда. Но окно живёт двое суток,
-- и без отметки каждый материал оплачивался бы дважды — а заодно получал бы
-- второй бросок кубика по той же паре: вчерашнее «разные новости» могло бы
-- сегодня обернуться «дубль». Ровно так же и по той же причине отмечена
-- расшифровка роликов (0036_item_transcribed).
alter table dailynews.items
  add column if not exists dup_asked_at timestamptz;

insert into dailynews.migrations (name) values ('0037_dedup_stage')
  on conflict (name) do nothing;
