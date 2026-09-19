-- Явная оценка материала. До сих пор калибровка опиралась только на
-- косвенное — попался на глаза, раскрыл, ушёл к источнику. Палец вверх
-- и вниз дают прямой ответ, и он сильнее любого косвенного признака:
-- «не открыл» может значить что угодно, «скрыть» не значит ничего другого.
alter table dailynews.reads drop constraint if exists reads_event_check;
alter table dailynews.reads add constraint reads_event_check
  check (event in ('seen', 'opened', 'dwell', 'outbound', 'dismissed', 'up', 'down'));

insert into dailynews.migrations (name) values ('0010_vote_events')
  on conflict (name) do nothing;
