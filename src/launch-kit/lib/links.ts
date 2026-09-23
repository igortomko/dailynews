export interface LinkFields {
  url: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  ref: string;
}

type LinkLabelField = Exclude<keyof LinkFields, "url">;

const presetValues: Partial<Record<LinkLabelField, readonly string[]>> = {
  source: [
    "telegram",
    "x",
    "linkedin",
    "youtube",
    "instagram",
    "tiktok",
    "reddit",
    "google",
    "newsletter",
    "partner",
  ],
  medium: [
    "social",
    "organic",
    "paid_social",
    "cpc",
    "email",
    "referral",
    "affiliate",
    "community",
  ],
};

const queryKey: Record<LinkLabelField, string> = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
  content: "utm_content",
  term: "utm_term",
  ref: "ref",
};

function safeLabel(value: string): boolean {
  return value.length > 0 && value.length <= 100 && !/[\u0000-\u001f@]/.test(value);
}

/**
 * Built-in source/medium values come from this module. Other suggestions are
 * derived solely from links that the owner explicitly saved in this browser.
 */
export function linkSuggestions(
  field: LinkLabelField,
  savedUrls: readonly string[],
): string[] {
  const values = new Set(presetValues[field] ?? []);
  for (const savedUrl of savedUrls) {
    try {
      const value = new URL(savedUrl).searchParams.get(queryKey[field])?.trim();
      if (value && safeLabel(value)) values.add(value);
    } catch {
      // Old or malformed browser storage cannot become a suggestion.
    }
  }
  return [...values].slice(0, 20);
}

export function buildCampaignLink(fields: LinkFields): string {
  const url = new URL(fields.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "Нужен HTTPS URL без логина, пароля и нестандартного порта.",
    );
  const allowed = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "ref",
  ]);
  for (const key of [...url.searchParams.keys()])
    if (!allowed.has(key))
      throw new Error(
        "Уберите из URL посторонние параметры: токены и личные данные нельзя сохранять в ссылках кампаний.",
      );
  const params = {
    utm_source: fields.source,
    utm_medium: fields.medium,
    utm_campaign: fields.campaign,
    utm_content: fields.content,
    utm_term: fields.term,
    ref: fields.ref,
  };
  if (!fields.source.trim() && !fields.ref.trim())
    throw new Error("Укажите source или простой ref.");
  for (const [key, raw] of Object.entries(params)) {
    const value = raw.trim();
    if (value && !safeLabel(value))
      throw new Error(
        "Метка должна быть до 100 символов, без email и управляющих символов.",
      );
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url.toString();
}
