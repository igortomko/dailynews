import { PLAN_IDS, PLANS, type PlanId } from "./plans";
import { paddleApi, type Cycle } from "./billing";

/**
 * Каталог Paddle — производное от `PLANS`, а не вторая правда.
 *
 * Цена, триал и годовая оплата пишутся один раз, в `src/lib/plans.ts`.
 * Веб при старте (`PADDLE_SYNC=1`, только в боевом контейнере) подтягивает
 * к ним Paddle: заводит недостающие цены и правит суммы и триал у тех,
 * что разошлись. id цен нигде не хранятся: цена находится по метке
 * `custom_data: { plan, cycle }`, а вебхук берёт тариф из той же метки
 * в самом событии.
 *
 * Правка суммы у Paddle не трогает уже оформленные подписки: они
 * продлеваются по цене, с которой начались. Новая цена — для новых.
 *
 * Синхронизирует только боевой контейнер: `npm run dev` на ветке ходит
 * в тот же аккаунт Paddle, и ветка с экспериментальной ценой переписала
 * бы её всем.
 */
const APP = "reporta";

type PaddlePrice = {
  id: string;
  status: string;
  unit_price: { amount: string; currency_code: string };
  billing_cycle: { interval: string; frequency: number } | null;
  trial_period: { interval: string; frequency: number } | null;
  custom_data: { plan?: string; cycle?: string } | null;
};

async function paddle<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new Error("PADDLE_API_KEY не задан");
  const response = await fetch(`${paddleApi()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Paddle ${init.method ?? "GET"} ${path}: ${response.status} ${body?.error?.detail ?? ""}`);
  return body.data as T;
}

/** Что должно стоять в Paddle, по `PLANS`. */
export function desiredPrices() {
  return PLAN_IDS.flatMap((plan) => {
    const p = PLANS[plan];
    if (p.price <= 0) return [];
    const cycles: { cycle: Cycle; usd: number }[] = [{ cycle: "month", usd: p.price }];
    if (p.yearPrice > 0) cycles.push({ cycle: "year", usd: p.yearPrice });
    return cycles.map(({ cycle, usd }) => ({
      plan, cycle,
      amount: String(Math.round(usd * 100)),
      trialDays: p.trialDays,
      name: `${p.label} ${cycle === "year" ? "yearly" : "monthly"}`,
    }));
  });
}

const cycleOfData = (data: PaddlePrice["custom_data"]): Cycle => (data?.cycle === "year" ? "year" : "month");

async function product(): Promise<string> {
  const products = await paddle<{ id: string; custom_data: { app?: string } | null }[]>("/products?status=active&per_page=200");
  const mine = products.find((p) => p.custom_data?.app === APP);
  if (mine) return mine.id;
  const created = await paddle<{ id: string }>("/products", {
    method: "POST",
    body: JSON.stringify({
      name: "Reporta", tax_category: "standard", custom_data: { app: APP },
      description: "Personal daily news digest: collected, scored and written for each reader, delivered to Telegram, email and Kindle.",
    }),
  });
  return created.id;
}

const activePrices = (productId: string) =>
  paddle<PaddlePrice[]>(`/prices?product_id=${productId}&status=active&per_page=200`);

/** Подтянуть Paddle к `PLANS`. Возвращает, что сделано, — для лога старта. */
export async function syncCatalog(): Promise<string[]> {
  const productId = await product();
  const existing = await activePrices(productId);
  const done: string[] = [];
  for (const want of desiredPrices()) {
    const trial = want.trialDays > 0 ? { interval: "day", frequency: want.trialDays } : null;
    const found = existing.find((p) => p.custom_data?.plan === want.plan && cycleOfData(p.custom_data) === want.cycle);
    if (!found) {
      await paddle("/prices", {
        method: "POST",
        body: JSON.stringify({
          product_id: productId, name: want.name, description: `Reporta ${want.name}`,
          unit_price: { amount: want.amount, currency_code: "USD" },
          billing_cycle: { interval: want.cycle, frequency: 1 },
          trial_period: trial, custom_data: { plan: want.plan, cycle: want.cycle },
        }),
      });
      done.push(`${want.name}: заведена`);
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (found.unit_price.amount !== want.amount || found.unit_price.currency_code !== "USD") {
      patch.unit_price = { amount: want.amount, currency_code: "USD" };
    }
    if ((found.trial_period?.frequency ?? 0) !== want.trialDays || (trial && found.trial_period?.interval !== "day")) {
      patch.trial_period = trial;
    }
    // Метка цикла дописывается и у старой помесячной цены без неё: иначе
    // её пришлось бы угадывать по billing_cycle при каждом поиске.
    if (found.custom_data?.cycle !== want.cycle) patch.custom_data = { plan: want.plan, cycle: want.cycle };
    if (Object.keys(patch).length) {
      await paddle(`/prices/${found.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      done.push(`${want.name}: ${Object.keys(patch).join(", ")}`);
    }
  }
  catalog = null;
  return done;
}

/**
 * id цены под тариф и период. Кэш на десять минут: страница оплаты
 * открывается редко, а лишний круг до Paddle на каждое открытие — это
 * секунда ожидания перед окном.
 */
let catalog: { at: number; ids: Map<string, string> } | null = null;

export async function priceIdFor(plan: PlanId, cycle: Cycle): Promise<string | null> {
  if (!catalog || Date.now() - catalog.at > 10 * 60_000) {
    const prices = await activePrices(await product());
    catalog = {
      at: Date.now(),
      ids: new Map(prices.filter((p) => p.custom_data?.plan).map((p) => [`${p.custom_data!.plan}-${cycleOfData(p.custom_data)}`, p.id])),
    };
  }
  return catalog.ids.get(`${plan}-${cycle}`) ?? null;
}
