import { currentReader } from "@/lib/session";
import { effectivePlan } from "@/lib/lemon";
import { DeliveryForm } from "./form";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const reader = await currentReader();
  return (
    <DeliveryForm
      connected={Boolean(reader.telegram_id)}
      username={reader.username}
      kindleAddress={reader.kindle_address ?? ""}
      kindleDigest={reader.kindle_digest}
      kindleApproved={reader.kindle_approved}
      sender={reader.kindle_sender}
      plan={effectivePlan(reader)}
    />
  );
}
