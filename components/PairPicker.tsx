"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type GameMeta, pairLabel, teamOf } from "@/lib/types";

/**
 * Choose which two pairs a set of boards was played between.
 *
 * The selection lives in the URL rather than in storage, so a segment is
 * linkable and the server can render it directly. Picking a pair reveals
 * nothing on its own: an open round only ever shows boards you entered.
 */
export function PairPicker({ meta, nsPair, ewPair }: { meta: GameMeta; nsPair: string; ewPair: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function choose(side: "ns" | "ew", value: string) {
    const next = new URLSearchParams(params);
    next.set(side, value);

    // Two pairs from one team can never play each other, so drop a stale
    // opponent rather than letting an impossible pairing sit in the form.
    const other = side === "ns" ? next.get("ew") : next.get("ns");
    if (value && other && teamOf(value) === teamOf(other)) next.delete(side === "ns" ? "ew" : "ns");

    router.replace(`?${next.toString()}`, { scroll: false });
  }

  const options = (exclude: string) =>
    meta.pairs.filter((pair) => !exclude || teamOf(pair.id) !== teamOf(exclude));

  return (
    <div className="grid-2">
      <div>
        <label htmlFor="ns-select">North–South</label>
        <select id="ns-select" value={nsPair} onChange={(event) => choose("ns", event.target.value)}>
          <option value="">Choose a pair…</option>
          {options(ewPair).map((pair) => (
            <option key={pair.id} value={pair.id}>
              {pairLabel(meta, pair.id)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ew-select">East–West</label>
        <select id="ew-select" value={ewPair} onChange={(event) => choose("ew", event.target.value)}>
          <option value="">Choose a pair…</option>
          {options(nsPair).map((pair) => (
            <option key={pair.id} value={pair.id}>
              {pairLabel(meta, pair.id)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
