import { getAllTopics, getProfile } from "@/lib/queries";
import { PersonalizationForm } from "./form";

export const dynamic = "force-dynamic";

export default async function PersonalizationPage() {
  const [profile, topics] = await Promise.all([getProfile(), getAllTopics()]);
  return (
    <PersonalizationForm
      profile={profile}
      chips={topics
        .filter((topic) => topic.active)
        .map((topic) => ({ slug: topic.slug, label: topic.label, hint: topic.hint }))}
    />
  );
}
