"use client";

import { useState } from "react";

export function CopyLink({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* буфер недоступен — ссылка видна рядом и выделяется руками */ }
      }}
    >
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}
