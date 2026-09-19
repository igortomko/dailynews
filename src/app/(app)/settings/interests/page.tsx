import { getAllTopics, getProfile } from "@/lib/queries";
import { InterestsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const [topics, profile] = await Promise.all([getAllTopics(), getProfile()]);
  return (
    <InterestsForm
      total={profile.digest_size}
      chips={topics
        .filter((topic) => topic.active)
        .map((topic) => ({
          slug: topic.slug,
          label: topic.label,
          hint: topic.hint,
          count: topic.weight,
        }))}
    />
  );
}
