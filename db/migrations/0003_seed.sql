-- Стартовые интересы и каталог источников.
-- Все RSS-адреса проверены живым запросом 19 сентября 2026;
-- те, что не ответили или отдали только архив, сюда не попали.
-- Онбординг это всё переписывает — здесь только состояние «работает из коробки».

insert into dailynews.topics (slug, label, hint, position) values
  ('ai-infra',   'AI-инфра',
   'модели, чипы, дата-центры, инференс, обучение, агенты, инструменты разработки с LLM', 1),
  ('energy',     'Энергетика и уран',
   'атомная энергетика, уран и его добыча, электросети, спрос на энергию под дата-центры, нефть и газ', 2),
  ('blockchain', 'Блокчейн',
   'криптовалюты, DeFi, стейблкоины, ончейн-инфраструктура, регулирование', 3),
  ('demography', 'Демография',
   'рождаемость, старение, миграция, население стран, долгосрочные социальные сдвиги', 4),
  ('mental-health', 'Психотерапия и mental health',
   'доказательная психотерапия, клинические исследования, психиатрия, инструменты для терапевтов, выгорание', 5),
  ('design',     'Дизайн и продукт',
   'продуктовый дизайн, исследования пользователей, интерфейсы, продуктовый менеджмент, рост продукта', 6)
on conflict (slug) do nothing;

insert into dailynews.sources (kind, label, url, config) values
  ('hackernews', 'Hacker News', 'topstories', '{"count": 90}'::jsonb),

  ('rss', 'Simon Willison',        'https://simonwillison.net/atom/everything/', '{}'::jsonb),
  ('rss', 'Latent Space',          'https://www.latent.space/feed',             '{}'::jsonb),
  ('rss', 'Hugging Face',          'https://huggingface.co/blog/feed.xml',      '{}'::jsonb),
  ('rss', 'OpenAI',                'https://openai.com/news/rss.xml',           '{}'::jsonb),
  ('rss', 'Google DeepMind',       'https://deepmind.google/blog/rss.xml',      '{}'::jsonb),

  ('rss', 'World Nuclear News',    'https://world-nuclear-news.org/rss',        '{}'::jsonb),
  ('rss', 'OilPrice',              'https://oilprice.com/rss/main',             '{}'::jsonb),

  ('rss', 'Cointelegraph',         'https://cointelegraph.com/rss',             '{}'::jsonb),
  ('rss', 'Decrypt',               'https://decrypt.co/feed',                   '{}'::jsonb),
  ('rss', 'a16z crypto',           'https://a16zcrypto.com/feed/',              '{}'::jsonb),

  ('rss', 'Our World in Data',     'https://ourworldindata.org/atom.xml',       '{}'::jsonb),

  ('rss', 'PsyPost',               'https://www.psypost.org/feed',              '{}'::jsonb),

  ('rss', 'Nielsen Norman Group',  'https://www.nngroup.com/feed/rss/',         '{}'::jsonb),
  ('rss', 'Lenny''s Newsletter',   'https://www.lennysnewsletter.com/feed',     '{}'::jsonb),
  ('rss', 'Stratechery',           'https://stratechery.com/feed/',             '{}'::jsonb),
  ('rss', 'UX Collective',         'https://uxdesign.cc/feed',                  '{}'::jsonb),

  -- Reddit требует REDDIT_CLIENT_ID и REDDIT_CLIENT_SECRET: анонимные запросы
  -- получают 429 уже на втором сабреддите. Без ключей источники будут
  -- показывать ошибку в настройках — это нагляднее, чем молчать.
  ('reddit', 'r/LocalLLaMA',       'LocalLLaMA',       '{}'::jsonb),
  ('reddit', 'r/singularity',      'singularity',      '{}'::jsonb),
  ('reddit', 'r/uraniumsqueeze',   'uraniumsqueeze',   '{}'::jsonb),
  ('reddit', 'r/NuclearPower',     'NuclearPower',     '{}'::jsonb),
  ('reddit', 'r/CryptoCurrency',   'CryptoCurrency',   '{}'::jsonb),
  ('reddit', 'r/defi',             'defi',             '{}'::jsonb),
  ('reddit', 'r/psychotherapy',    'psychotherapy',    '{}'::jsonb),
  ('reddit', 'r/therapists',       'therapists',       '{}'::jsonb),
  ('reddit', 'r/ProductManagement','ProductManagement','{}'::jsonb),
  ('reddit', 'r/indiehackers',     'indiehackers',     '{}'::jsonb)
on conflict (kind, url) do nothing;

update dailynews.profile
   set reader_context = 'Игорь — продуктовый дизайнер и фаундер Sessio (AI для психотерапевтов: запись → транскрипт → клинические заметки). Стек: Tauri, Next.js, FastAPI, PostgreSQL. Живёт в Бразилии.'
 where id = 1 and reader_context = '';

insert into dailynews.migrations (name) values ('0003_seed')
  on conflict (name) do nothing;
