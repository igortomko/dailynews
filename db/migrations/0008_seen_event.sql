-- Раньше единственным сигналом было раскрытие карточки: саммари прятали,
-- и «открыл» означало «захотел прочитать». Теперь саммари видно сразу,
-- и различать надо три уровня: попался на глаза, задержался, ушёл к источнику.
--
-- Без 'seen' знаменатель калибровки неизвестен: доля открытий считалась бы
-- от показанного в дайджесте, а не от реально дошедшего до экрана.
alter table dailynews.reads drop constraint if exists reads_event_check;
alter table dailynews.reads add constraint reads_event_check
  check (event in ('seen', 'opened', 'dwell', 'outbound', 'dismissed'));

insert into dailynews.migrations (name) values ('0008_seen_event')
  on conflict (name) do nothing;
