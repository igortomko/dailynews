-- Оплата переехала с Lemon Squeezy на Paddle.
--
-- Колонки подписки из 0029 те же: номер, статус, даты. Новая одна —
-- когда случилось последнее применённое событие. Paddle не обещает
-- порядок доставки: subscription.updated об отмене может прийти раньше
-- subscription.created, и без отметки опоздавшее старое событие вернуло бы
-- отменённой подписке active. Вебхук пишет только событие новее этой отметки.
--
-- portal_url больше не пишется: у Paddle ссылка на портал живёт минуты
-- и выдаётся на каждое нажатие (`/api/billing/portal`). Колонка остаётся
-- непрочитанной — сносить её отдельной миграцией дороже, чем не читать.
alter table dailynews.readers
  add column if not exists subscription_event_at timestamptz;

insert into dailynews.migrations (name) values ('0070_paddle_event_at')
  on conflict (name) do nothing;
