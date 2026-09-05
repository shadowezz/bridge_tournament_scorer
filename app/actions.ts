"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { store } from "@/lib/store";
import { validateSegmentPairing } from "@/lib/tournament/validate";
import { clientId } from "@/lib/session";
import { buildGameMeta } from "@/lib/tournament/setup";
import { parseSegmentRows, type SegmentSubmission } from "@/lib/forms";

export async function createGame(form: FormData): Promise<void> {
  const meta = buildGameMeta(form);
  await store().createGame(meta);
  redirect(`/g/${meta.id}`);
}

/**
 * Save one segment's boards.
 *
 * The submitted rows are the segment's contents, not a patch: the store
 * removes any board this client may touch that the form no longer lists, so
 * clearing a row and retyping its board number both delete the old entry.
 *
 * Contracts are parsed here rather than trusted from the client, so the
 * stored score always comes from the same engine the results use.
 */
export async function saveSegment(
  _previous: SegmentSubmission,
  form: FormData,
): Promise<SegmentSubmission> {
  const gameId = String(form.get("gameId") ?? "");
  const round = Number(form.get("round") ?? 0);
  const nsPair = String(form.get("nsPair") ?? "");
  const ewPair = String(form.get("ewPair") ?? "");

  const pairingError = validateSegmentPairing(nsPair, ewPair);
  if (pairingError) return { ok: false, errors: {}, conflicts: [], message: pairingError };

  const takeOver = String(form.get("takeOver") ?? "")
    .split(",")
    .map(Number)
    .filter(Number.isInteger);

  const { rows, errors, duplicates } = parseSegmentRows(form);

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, conflicts: [], message: "Some rows need fixing." };
  }
  if (duplicates.length > 0) {
    return {
      ok: false,
      errors: {},
      conflicts: [],
      message: `Board ${duplicates.join(", ")} is entered twice in this segment.`,
    };
  }

  const { conflicts, removed } = await store().writeSegment(gameId, {
    round,
    nsPair,
    ewPair,
    rows,
    clientId: await clientId(),
    takeOver,
  });

  revalidatePath(`/g/${gameId}`, "layout");

  // An empty form is not an instruction to wipe anything - it is someone who
  // has not typed yet, and saying "Saved." to them would be a lie.
  if (rows.length === 0 && removed.length === 0) {
    return { ok: false, errors: {}, conflicts: [], message: "Nothing to save yet." };
  }

  const deleted = removed.length > 0 ? ` Board ${removed.join(", ")} deleted.` : "";

  return {
    ok: conflicts.length === 0,
    errors: {},
    conflicts,
    message:
      conflicts.length > 0
        ? `Board ${conflicts.join(", ")} was entered by someone else and was left unchanged.${deleted}`
        : `Saved.${deleted}`,
  };
}

export async function deleteBoard(
  gameId: string,
  round: number,
  nsPair: string,
  ewPair: string,
  board: number,
): Promise<void> {
  await store().deleteEntries(gameId, {
    round,
    nsPair,
    ewPair,
    boards: [board],
    clientId: await clientId(),
  });
  revalidatePath(`/g/${gameId}`, "layout");
}

export async function repointSegment(
  gameId: string,
  round: number,
  from: { nsPair: string; ewPair: string },
  to: { nsPair: string; ewPair: string },
): Promise<void> {
  await store().repointSegment(gameId, { round, from, to, clientId: await clientId() });
  revalidatePath(`/g/${gameId}`, "layout");
}
