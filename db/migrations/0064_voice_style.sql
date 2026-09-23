-- «Писать черновики в моём стиле»: свитчер и текст стиля.
--
-- `voice_skill` — инструкция, по которой пишется черновик: её пишет автор,
-- загружает готовым skill-файлом или получает кнопкой «Изучи мой стиль»
-- из своих постов и правит. Колонка уже стоит в живой базе — её завела
-- невлитая ветка с той же идеей (0038_voice_skill), — поэтому
-- `if not exists`: здесь она впервые заводится миграцией из main.
--
-- `voice_enabled` — свитчер. Выключен — черновик пишется настройками подачи.
-- Тем, у кого карточка уже собрана, он включается сразу: иначе правка
-- молча выключила бы им стиль, которым они уже пользуются.
alter table dailynews.readers
  add column if not exists voice_skill text not null default '';

alter table dailynews.readers
  add column if not exists voice_enabled boolean not null default false;

update dailynews.readers
   set voice_enabled = true
 where voice_card is not null and not voice_enabled;

insert into dailynews.migrations (name) values ('0064_voice_style')
  on conflict (name) do nothing;
