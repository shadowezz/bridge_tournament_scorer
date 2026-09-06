# CLAUDE.md

Guidance for working in this repo.

## What this is

A scorer for a single in-house bridge tournament: **3 teams of 4, 3 rounds of
duplicate IMPs teams, victory points**. All boards are non-vulnerable. Twelve
players, one evening, phones at the table.

It tracks **scores only — it does not direct the movement.** Who sits where is
arranged offline. Players record which two pairs played which boards, and every
structure (matchups, orientations, scoresheets) is *derived* from pair→team
membership. There is no model of the movement anywhere in the code.

There are **no accounts**. Knowing the 12-character game URL is the only access
control. Identity is an anonymous per-browser `clientId`.

`.claude/implementation-plan.md` is the living design doc — decisions, the data
model, storage layout, and a verification log. Read it before changing anything
load-bearing; update it when you contradict it. `README.md` is the short version.

## Core model

- **Segment** — six boards played by two pairs in one orientation, keyed
  `(round, nsPair, ewPair)`. This is the unit players enter and the unit a save
  replaces.
- **Round** — six segments, 36 boards (`ENTRIES_PER_ROUND`).
- **Matchup** — the two orientations of the same two teams, found by grouping on
  `matchupKey(teamOf(ns), teamOf(ew))`. Each six-board set is played twice in
  opposite orientations, so the halves find each other with no movement model.
- **Scoring** — per board, `difference = nsScore + ewScore` across the two
  orientations → standard IMP table (`lib/bridge/imps.ts`) → continuous 20-VP
  scale blitzing at 37 IMPs, `round(15·√6)` (`lib/bridge/vp.ts`).

Board numbers are **typed by players, not assigned** — numbering changes on the
day. The movement guarantees both halves of a matchup cover the same six boards,
so a typo surfaces as an unmatched board on exactly one side and is named in
validation. Unmatched boards are *excluded* from IMPs, never silently scored.

## Identity, admin, and the round lifecycle

`clientId` — 10 chars of Crockford base32 (no I/L/O/U, survives being read
aloud), issued server-side in `proxy.ts` on first contact, stored in the
`bt_cid` cookie. Deliberately **not** `httpOnly` so `SessionCode.tsx` can mirror
it to localStorage and show it as a recovery code.

**Admin** is held by client id; several people can hold it at once. Anyone with
the link can claim it until an admin turns claiming off — a toggle, so a
latecomer can be let back in. There is no revoke and no reopening an ended
round; together those mean a game can never end up locked with zero admins, so
no lockout safeguard exists.

**A round does not end itself.** Reaching 36 boards only shows "ready"; an admin
presses End round. Writing `r<n>|result` *is* the ending — it is the latch, and
nothing else creates one.

| | Round running | Round ended |
|---|---|---|
| See others' boards | No — board number only | Yes, everything |
| Edit your own | Yes | **No** — admins only |
| Edit someone else's | Via "enter it myself instead" | Admins only |
| Admin sees more | **No** — masked like everyone | — |

Admins get no early sight on purpose: admin is the power to end a round and
correct it afterwards, not to peek at one in progress.

## Invariants — break these and something silently goes wrong

1. **Visibility is filtered server-side**, in `lib/visibility.ts`. Hidden
   contracts must never reach the browser to be hidden with CSS.
2. **`record.admins` never leaves the server.** A client id is a bearer
   credential — the session box accepts any code and becomes it — so
   `visibleGame` reduces it to `isAdmin` + `adminCount` before rendering.
3. **One mutation path.** `writeSegment`, `deleteEntries` and `repointSegment`
   all funnel through `resultFieldsFor`, which recomputes and rewrites
   `r<n>|result` in the *same* backend write. No path may edit an entry without
   the victory points following.
4. **`sourceDigest` self-heals.** A SHA-256 of the round's sorted entries,
   checked on every `loadGame` and repaired on mismatch. An invalidation bug
   degrades into a slow path, never into wrong VPs — a silently stale scoreboard
   is the one failure nobody catches during a live tournament. If your change
   makes the heal fire routinely, the primary path is broken; fix that instead.
5. **A save replaces the segment, it is not a patch.** Any board the client may
   touch and did not submit is removed in the same write. That is what makes
   renumbering safe.
6. **`endedAt` is fixed; `computedAt` moves.** Recomputes carry `endedAt`
   forward. `readRecord` back-fills it from `computedAt` for results written
   before admins existed.
7. **`lib/tournament/perspective.ts` must stay free of `node:crypto`** — a
   client component imports it, so its `compute.ts` import is type-only.
8. **`negate()` in `lib/types.ts`** avoids `-0`, which survives in memory but
   becomes `0` through JSON and breaks digest equality.
9. **`SegmentForm` is keyed `` `${round}|${nsPair}|${ewPair}` ``** in the round
   page. Without the key React reuses the instance and the previous table's rows
   and taken-over boards carry over.

## Storage

One hash per game, key `g:<gameId>`, **one field per board** so two people at
the same table can never overwrite each other — there is no read-modify-write of
a shared blob anywhere.

```
meta                            GameMeta
r<n>|<nsPair>|<ewPair>|<board>  { contract, nsScore, updatedAt, clientId }
r<n>|result                     RoundResult  (exists ⟺ round ended)
admin|<clientId>                { claimedAt }   one field per admin
claiming                        "open" | "closed"   absent means open
```

Round, pairs and board live in the *field name*, so they cannot drift from the
value. Absent fields read as sensible defaults, so **no migration is ever
needed** — older games just work.

`lib/store/backend.ts` is the whole adapter interface (`readAll`, `write`,
`exists`). Redis in production; a JSON file per game under `data/games/` locally.
Selection is by env in `defaultBackend()` — and it **throws** on Vercel with no
credentials rather than falling back to a read-only filesystem, which would hide
the mistake until the first save failed mid-round.

## Structure

```
app/
  page.tsx                          landing / create tournament
  actions.ts                        ALL server actions — there are no API routes
  g/[gameId]/layout.tsx             loads game, header, nav, SessionCode
  g/[gameId]/page.tsx               standings, round cards, AdminPanel
  g/[gameId]/round/[round]/page.tsx pair picker + SegmentForm
  g/[gameId]/results/[round]/       scoresheets + round VP
lib/
  bridge/       contract.ts (parse "4HxN+1") score.ts imps.ts vp.ts
  tournament/   setup.ts matchups.ts validate.ts compute.ts perspective.ts
  store/        backend.ts fs.ts redis.ts index.ts
  types.ts ids.ts cookies.ts session.ts admin.ts forms.ts visibility.ts
components/     SegmentForm AdminPanel EndRoundButton Scoresheet MatchupCard
                Standings PairPicker SessionCode ValidationBanner …
proxy.ts        Next 16 middleware — issues the clientId cookie
__tests__/      vitest; `@/` → project root
```

Every mutation is a Server Action; every read is a Server Component calling
`store()` directly. Pages `await connection()` so nothing is cached; refresh is
manual via `RefreshButton` (`router.refresh()`). Nothing polls.

## Working here

- `npm test` (vitest), `npm run dev`, `npm run build`. **The tests are the
  spec** — `__tests__/store.test.ts` encodes ownership, take-over, segment
  replacement, admin claiming, ending and visibility. Change behaviour there
  first and let it tell you what else moves.
- Comments in this codebase explain **why**, not what, and often record a bug
  that was actually hit. Match that; don't strip them.
- The Chrome extension has not been able to inject into `localhost:3000` in this
  environment. Everything is server-rendered, so `curl` with a `bt_cid` cookie
  is a genuine end-to-end check — including POSTing a form's `$ACTION_ID_…` to
  exercise a server action with JS disabled.
- `next dev` generates `AGENTS.md` / `CLAUDE.md` for agents when they are
  absent, and `next build` removes the generated copies. It leaves *this* file
  alone (verified). Set `agentRules: false` in `next.config.ts` to stop the
  generation entirely.
