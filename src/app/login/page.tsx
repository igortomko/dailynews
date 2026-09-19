import { LoginForm } from "./form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const { next, expired } = await searchParams;
  // next читается на сервере: useSearchParams в клиенте потребовал бы
  // Suspense и всё равно не пережил бы пререндер.
  return (
    <div className="mx-auto flex min-h-svh max-w-sm items-center px-4">
      <LoginForm next={next ?? "/"} expired={expired === "1"} />
    </div>
  );
}
