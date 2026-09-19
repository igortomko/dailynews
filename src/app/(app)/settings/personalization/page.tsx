import { currentReader } from "@/lib/session";
import { PersonalizationForm } from "./form";

export const dynamic = "force-dynamic";

export default async function PersonalizationPage() {
  return <PersonalizationForm profile={await currentReader()} />;
}
