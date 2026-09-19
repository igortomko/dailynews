import { getAllTopics } from "@/lib/queries";
import { InterestsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const topics = await getAllTopics();
  return (
    <InterestsForm
      chips={topics
        .filter((topic) => topic.active)
        .map((topic) => ({ slug: topic.slug, label: topic.label, hint: topic.hint }))}
    />
  );
}
