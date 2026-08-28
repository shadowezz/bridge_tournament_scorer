"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Results only move when someone refreshes; nothing polls in the background. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button type="button" className="ghost" onClick={() => start(() => router.refresh())} disabled={pending}>
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
