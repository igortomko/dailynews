import { currentReader } from "@/lib/session";
import { DeliveryForm } from "./form";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const reader = await currentReader();
  return (
    <DeliveryForm
      connected={Boolean(reader.telegram_id)}
      username={reader.username}
      kindleAddress={reader.kindle_address ?? ""}
      sender={reader.kindle_sender}
    />
  );
}
