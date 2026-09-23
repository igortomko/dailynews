-- События оплаты для воронки дашборда.
--
-- До этой миграции дашборд кончался чтением: сколько людей дошли от /start
-- до карточки — видно, а сколько из них посмотрели тарифы, открыли оплату,
-- взяли триал и заплатили — нет. `readers` хранит только текущее состояние
-- подписки, а воронке нужен ряд: когда это случилось в первый раз.
--
-- id — ключ идемпотентности. Paddle повторяет доставку тем же event_id,
-- наши события (просмотр тарифов, открытие оплаты) сводятся до одного
-- на читателя в сутки: `plans-<читатель>-<день>`. Вставка — on conflict do
-- nothing, поэтому повтор ничего не удваивает.
--
-- Сумма — в центах и в валюте платежа, как её прислал Paddle: курс
-- считать не нам, и дашборд показывает деньги в валюте продукта.
create table if not exists dailynews.billing_events (
  id           text primary key check (length(id) between 1 and 200),
  reader_id    bigint references dailynews.readers (id) on delete set null,
  name         text not null check (name in (
                 'plans_viewed', 'checkout_started', 'trial_started',
                 'payment_succeeded', 'payment_refunded', 'canceled')),
  occurred_at  timestamptz not null,
  plan         text,
  cycle        text check (cycle in ('month', 'year')),
  amount_minor bigint check (amount_minor > 0),
  currency     text check (currency ~ '^[A-Z]{3}$'),
  payment_id   text,
  refund_id    text
);

create index if not exists billing_events_reader_idx
  on dailynews.billing_events (reader_id, occurred_at);

insert into dailynews.migrations (name) values ('0071_billing_events')
  on conflict (name) do nothing;
