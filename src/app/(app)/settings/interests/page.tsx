import { getAllTopics, getProfile } from "@/lib/queries";
import { InterestsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const [profile, topics] = await Promise.all([getProfile(), getAllTopics()]);
  return (
    <InterestsForm
      profile={profile}
      chips={topics
        .filter((topic) => topic.active)
        .map((topic) => ({ slug: topic.slug, label: topic.label, hint: topic.hint }))}
    />
  );
}
