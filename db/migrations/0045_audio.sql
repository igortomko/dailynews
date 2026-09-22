-- Озвучка статьи и словарь произношений.
--
-- Русский голос читает латиницу по русским правилам: на живых описаниях
-- `Gemini` звучал как «Джимр Найв Майя», `Qwen 3.5` — как «KORN 3.5»,
-- `x-High` — как «HIG». Разметить произношение тегами нельзя: эндпоинт
-- принимает только `speak`, `voice` и `prosody`, а `<lang>`, `<phoneme>`
-- и `<sub>` отбивает все до одного — проверено контрольным прогоном, где
-- тот же текст без тегов прошёл. Поэтому произношение подставляется
-- в текст, а подставлять надо из чего-то.

-- Как читается латинский термин. Общий на всех, как и первые два каскада:
-- «Gemini» звучит одинаково независимо от того, кто слушает, и спрашивать
-- модель об этом на каждого читателя значит платить за один ответ столько
-- раз, сколько у ленты людей.
--
-- Ключ в нижнем регистре: `Gemini` в заголовке и `gemini` в тексте — один
-- термин, и две строки на него означали бы два разных произношения одного
-- слова, расходящиеся тем тише, чем реже их сравнивают.
create table if not exists dailynews.spoken_terms (
  term   text primary key,
  spoken text not null,
  -- Откуда взялось: `seed` — из кода, `model` — спросили. Различать нужно,
  -- чтобы знать, что можно пересчитать новым промптом, а что правлено руками.
  source text not null default 'model',
  at     timestamptz not null default now()
);

-- Готовая озвучка. Ключ — материал и язык, а не материал и читатель:
-- озвучивается перевод, а он уже лежит в `item_translations` по той же
-- паре. Двум читателям на одном языке одна статья звучит одинаково,
-- и второму она достаётся бесплатно.
--
-- Хранится не файл, а `file_id` Telegram: переотправка по нему мгновенна
-- и не стоит ни байта трафика, а своего хранилища у продукта нет и заводить
-- его ради mp3 дороже, чем не заводить.
create table if not exists dailynews.item_audio (
  item_id  bigint not null references dailynews.items (id) on delete cascade,
  language text not null,
  file_id  text not null,
  -- Длительность нужна не для красоты: из неё считается расход квоты,
  -- а квота у Pro стоит в минутах.
  seconds  integer not null,
  voice    text not null,
  at       timestamptz not null default now(),
  primary key (item_id, language)
);

-- Кто сколько наслушал. Строка на отправку, а не счётчик в `readers`:
-- счётчик отвечает «сколько сейчас», а квота спрашивает «сколько за день»,
-- и гасить его по расписанию пришлось бы тем же ночным прогоном, который
-- ходит раз в сутки — то есть в день сброса квоты не было бы вовсе.
--
-- Она же и есть прогресс для интерфейса. Второй таблицы под «на каком
-- шаге» не нужно: шаг — это состояние той самой отправки, и разведи их,
-- появится отправка, которая идёт по одной таблице и стоит по другой.
create table if not exists dailynews.audio_sends (
  id        bigint generated always as identity primary key,
  reader_id bigint not null references dailynews.readers (id) on delete cascade,
  item_id   bigint not null references dailynews.items (id) on delete cascade,
  -- Шаги названы работой, а не процентами: перевод статьи занимает минуту,
  -- синтез — десятки секунд, и «43%» о них не говорит ничего, а «перевожу»
  -- говорит всё. Шагов ровно столько, сколько их видно снаружи.
  status    text not null default 'queued'
    check (status in ('queued', 'translating', 'speaking', 'sending', 'sent', 'failed')),
  error     text,
  seconds   integer,
  -- Правда ли мы это синтезировали или переслали готовое. Без различения
  -- пересылка выглядела бы такой же дорогой, как первая озвучка.
  fresh     boolean not null default true,
  at        timestamptz not null default now()
);

create index if not exists audio_sends_reader_day
  on dailynews.audio_sends (reader_id, at desc);


-- Этап расхода для озвучки: вопрос модели о том, как читается термин.
--
-- Список перечисляется целиком, вместе с чужими: ветка, пересоздавшая
-- этот check под свои значения, стирает этапы соседней, и у той на проде
-- молча падает запись расхода. Значения взяты из живой базы, а не из
-- прошлой миграции — там уже могут стоять ветки, до которых эта не дошла.
alter table dailynews.model_calls drop constraint if exists model_calls_stage_check;
alter table dailynews.model_calls add constraint model_calls_stage_check
  check (stage in (
    'score', 'digest', 'summary', 'translate', 'translation-quality',
    'video', 'voice', 'post', 'post-quality', 'interests', 'dedup',
    'spoken-terms'
  ));

insert into dailynews.migrations (name) values ('0045_audio')
  on conflict (name) do nothing;
