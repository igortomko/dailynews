import "server-only";

import type { Reader } from "@/lib/types";

/**
 * Brand colors roll out independently from the code deploy so the env can
 * switch the palette off and recreate only the web container.
 */
export function brandColorsV2Enabled(reader: Reader): boolean {
  const setting = process.env.REPORTA_BRAND_COLORS_V2?.trim().toLowerCase() ?? "off";

  if (setting === "all") return true;
  if (setting === "owner") return reader.owner;
  if (!setting.startsWith("readers:")) return false;

  const ids = setting
    .slice("readers:".length)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value));

  return ids.includes(reader.id);
}
