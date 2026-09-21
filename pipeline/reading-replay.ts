/** Live provider replay against an isolated local database. No production writes or delivery. */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import postgres from 'postgres';
import { startLocalPg, assertOwn } from '../db/free-port';
import { pooled } from './fetch';
import { writeReadingDigest } from './reading';
import type { Survivor } from './digest';
import type { Voice } from '../src/lib/voice';

type Sample = { reader: Voice & { reader_context: string }; items: { id: number; title: string; url: string; excerpt: string; text: string; source_label: string; transcribed_at: string | null }[] };
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: reading-replay.ts <sample.json> [item IDs] [output directory]');
  const sample: Sample = JSON.parse(readFileSync(file, 'utf8'));
  const ids = (process.argv[3] ?? '7800,7932,7776,7803').split(',').map(Number);
  const out = pathResolve(process.argv[4] ?? '/tmp/dailynews-reading-replay');
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec('create schema extensions; create role products_reader;');
  await db.exec(readdirSync('db/migrations').filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(`db/migrations/${f}`, 'utf8')).join('\n'));
  const local = await startLocalPg(db, port => new PGLiteSocketServer({ db, port, host: '127.0.0.1' }));
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${local.port}/postgres`;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
  try {
    await assertOwn(local, async q => (await sql.unsafe<{ token: string }[]>(q))[0]);
    const [reader] = await sql<{ id: number }[]>`update dailynews.readers set daily_cap_usd=2 where owner returning id::int`;
    const [source] = await sql<{ id: number }[]>`select id::int from dailynews.sources limit 1`;
    const survivors: Survivor[] = [];
    for (const item of sample.items.filter(i => ids.includes(i.id))) {
      await sql`insert into dailynews.items(id,source_id,title,title_norm,url,url_canon,excerpt,body,transcribed_at) overriding system value values
        (${item.id},${source.id},${item.title},${item.title.toLowerCase()},${item.url},${item.url},${item.excerpt},${item.text},${item.transcribed_at})`;
      survivors.push({ ...item, body: item.text, topic_label: 'По теме статьи', axes: {}, total: 0 } as unknown as Survivor);
    }
    for (let round = 1; round <= 2; round++) {
      await pooled(survivors, 2, async item => {
        const start = Date.now();
        const result = await writeReadingDigest(sql, [item], sample.reader.reader_context, sample.reader, { readerId: reader.id, force: true });
        writeFileSync(`${out}/${item.id}-${round}.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
        console.log(JSON.stringify({ round, item: item.id, status: result.items[0]?.reading?.status, genre: result.items[0]?.reading?.document?.genre, blocks: result.items[0]?.reading?.document?.blocks.map(b => b.kind), seconds: Math.round((Date.now()-start)/1000), requests: result.usage.requests }));
      });
    }
    const [cost] = await sql`select count(*)::int as calls, sum(cost_usd)::float as usd from dailynews.model_calls`;
    console.log(JSON.stringify({ cost }));
  } finally { await sql.end(); await local.stop(); await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
