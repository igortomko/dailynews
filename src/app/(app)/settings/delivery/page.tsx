import { currentReader } from "@/lib/session";
import { kindlePeriodOf } from "@/lib/types";
import { effectivePlan } from "@/lib/lemon";
import { timezoneOf } from "@/lib/issue-time";
import { DeliveryForm } from "./form";

export const dynamic = "force-dynamic";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const reader = await currentReader();
  // Ответ ссылки подтверждения почты (`/auth/email-confirm`): приходят
  // сюда из письма, и сказать, чем кончилось, больше негде.
  const answer = (await searchParams).email;
  const emailResult = answer === "ok" || answer === "taken" || answer === "expired" ? answer : null;
  return (
    <DeliveryForm
      connected={Boolean(reader.telegram_id)}
      username={reader.username}
      email={reader.email}
      emailDigest={reader.email_digest}
      telegramDigest={reader.telegram_digest}
      emailResult={emailResult}
      kindleAddress={reader.kindle_address ?? ""}
      kindleDigest={reader.kindle_digest}
      kindlePeriod={kindlePeriodOf(reader.kindle_period)}
      podcast={reader.podcast}
      timezone={timezoneOf(reader.timezone)}
      kindleApproved={reader.kindle_approved}
      sender={reader.kindle_sender}
      plan={effectivePlan(reader)}
    />
  );
}
