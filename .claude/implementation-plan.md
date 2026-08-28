# Implementation plan — in-house bridge tournament scorer

Final design record for the app built from [`plan.md`](./plan.md). That file is the
original brief and is left untouched; this one records what was decided, why, what
changed during the build, and how it was verified.

Status: **built and verified.** ~3,900 lines, 117 unit tests, clean typecheck and
production build.

---

## Context

Twelve friends, three teams of four, three rounds of duplicate IMPs teams with
victory points. Scoring this by hand is slow and error-prone: each round produces
three separate 6-board team matches whose scores must be cross-referenced between
two tables, converted to IMPs, then to VPs.

**The app tracks scores only. It does not direct the movement.** Who sits where is
arranged offline. The app therefore models *results*, not seating: players record
which two pairs played each set of boards, and everything else is derived.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) + TypeScript | One process serves UI and data; server components let the visibility filter run server-side |
| Deployment | Vercel, serverless, public domain | User's requirement |
| Storage | Upstash Redis via Vercel Marketplace | One click, two auto-injected env vars, no schema, free tier far beyond 12 players |
| Storage shape | One hash per game, **one field per board** | Field writes are atomic and independent, so two tables can never collide |
| VP scale | Continuous 20-VP, blitz at `round(15·√6) = 37` IMPs | Exactly specifiable; no lookup table to get wrong |
| Board numbers | User-entered; system **validates** they tally | Numbering may change on the day |
| Contract entry | One parsed text field per row, score computed by system | Fastest at the table; the echoed score catches strain typos |
| Pairs | Chosen from dropdowns per submission | No movement model anywhere |
| Mid-round visibility | Strictly own submissions, keyed on anonymous `clientId` | A misclicked dropdown then reveals nothing |
| Refresh | Manual only — no polling | User's requirement |
| Round results | Computed and persisted at round close; edits propagate to VP | Durable audit record |
| Mutations | **Server Actions** (deviation — see below) | Server components already read the store directly |

---

## Core model

### The segment

The unit of submission is a **segment**: up to six boards played between two
specific pairs in one orientation.

```
segment = (round, nsPair, ewPair) → Entry[]
Entry   = { board, contract, nsScore, updatedAt, clientId }
```

`(round, nsPair, ewPair)` is unique — within a round a pair meets two different
opponents, and its orientation is fixed for each. A full round is six segments,
36 boards.

### Everything derives from pair→team membership

Each pair belongs to a team, fixed at game creation. That single fact is enough:

- **Matchup** — `team(nsPair)` and `team(ewPair)` give an unordered team pair.
  Always A–B, A–C, B–C.
- **The two instances of a board** — within a matchup, the two entries sharing a
  board number in *opposite* team orientations.
- **Board score** — for the home team, `difference = nsScore + ewScore`, where
  `ewScore` is the negation of the other table's NS score. Then
  `imps = impTable(|difference|) · sign(difference)`.
- **Scoresheet** — maps 1:1 onto `example_scoresheet.png`: left block is the home team's
  NS pair, right block its EW pair, IMP ± on the right. Because a team match is
  scored by comparing a team's *own* two pairs, both blocks belong to one team;
  each block therefore names the opponent that pair faced, and a per-matchup
  toggle retells the same result from the other team's side.

No tables, halves or seating rotation appear anywhere in the model.

---

## Scoring engine

All tournament boards are non-vulnerable, but the vulnerable branch is implemented
so the engine can be checked against `example_scoresheet.png`, which contains a mix.

Trick values `C/D = 20`, `H/S = 30`, `NT = 40` then `30`. Game bonus when the
**doubled** trick score reaches 100 (NV 300, vul 500), else partscore 50. Slam NV
500 / grand 1000. Insult 50 / 100. Doubled overtricks NV 100 each. Doubled
undertricks NV `100, 300, 500, 800, …`.

Standard IMP table, 0–10 → 0 up to 4000+ → 24.

VP: `VPwin = min(20, 10 + 10·d/37)`, `VPloss = 20 − VPwin`, to 2 dp, with the
loser's score derived by subtraction so the pair always totals exactly 20. A
team's round VP is the sum of its two matchups (max 40); tournament max 120.

> **Trap worth remembering:** diamonds are 20 per trick, not 30. A first pass had
> this wrong and only `5D+2` and `3D+1` exposed it.

---

## Identity and visibility

### `clientId`

Anonymous, persistent, per-browser. It is the **only** thing gating mid-round
reads, so it is made durable:

- Issued server-side in `proxy.ts` on first contact — 10 characters of Crockford
  base32 (no I, L, O, U, so it survives being read aloud).
- Stored as cookie `bt_cid`, one year, `SameSite=Lax`, `Secure` in production.
  A cookie rather than localStorage because filtering happens in server
  components, and localStorage is not sent with the request.
- Deliberately **not** `httpOnly`, so the page can mirror it to localStorage and
  restore it if the cookie is evicted.
- Shown as a copyable recovery code with a "restore session" field, for the cases
  that cannot be automated (a different phone).

**The damage from losing it is bounded**: you are blinded only for the remainder
of the current round. Once the round closes everything is public and editable, so
typo fixes remain possible. It is an annoyance, not data loss.

### Read rules — enforced server-side, never by hiding data in the browser

For an **open** round the server returns:

- **Full content** for entries whose `clientId` matches the requester.
- **Board number only** for every other entry — no contract, declarer, score,
  author or timing. The form renders `Bd 2 — already entered`.
- Round progress (`31 / 36 boards`) — counts only.

Selecting a pair therefore reveals nothing; a misclicked dropdown shows at most
which board numbers exist.

For a **closed** round (36 boards in) and for standings, everything is visible to
everyone.

### Write rules

- You may edit or delete only entries you own.
- A board marked `already entered` offers **"enter it myself instead"** — an
  explicit action that overwrites and transfers ownership without ever displaying
  the previous value. This is the escape hatch for a partner's typo mid-round.
- You may repoint your own segment's pairing if the dropdowns were wrong.
- Editing after close is unrestricted and triggers a full recompute.

---

## Validation

Two classes of error matter, and both are catchable.

**Board-number typos.** For each matchup, the boards where team A sat NS must equal
the boards where team B sat NS. A typo shows up as unmatched on exactly one side,
so the message names both:

> **Sharks vs Eagles — board mismatch.** Sharks A1 NS vs Eagles B1 EW has 1, 2, 3,
> 4, 5, **6**. Eagles B2 NS vs Sharks A2 EW has 1, 2, 3, 4, 6, **16**. Unmatched:
> 6, 16. Likely a typo — one of these should be corrected.

**Dropdown mistakes**, possible because pairs are hand-picked:

| Code | Severity | Catches |
|---|---|---|
| `same-team-segment` | error | Two pairs from one team facing each other |
| `same-team-ns-twice` | error | Both halves of a matchup listing the same team as NS |
| `repeated-pair-in-matchup` | error | A1 entered where A2 was meant |
| `duplicate-board-in-segment` | error | The same board twice on one card |
| `wrong-board-count` / `wrong-segment-count` | error | Structural impossibilities |
| `pair-in-too-many-segments` | warning | A pair playing more than two segments |

`same-team-ns-twice` and `repeated-pair-in-matchup` matter most: they are the ones
that would otherwise produce *silently wrong* IMPs rather than an obvious error.

A round that closes but fails validation is stored `status: "unresolved"`, still
shows its results — it really is over — behind a prominent banner, and **excludes
unmatched boards from the IMPs** rather than scoring them.

`validateSegmentPairing` additionally rejects an impossible pairing before it is
ever stored.

---

## Contract parsing

One text field per row. Parsed case-insensitively, whitespace optional, left to
right: level → strain (longest match, `NT` before `N`) → doubles → declarer →
result. Doubles accepted on either side of the declarer; omitted result means `=`.

Accepts `4HxN+1`, `4H x N +1`, `4hxn+1`, `4HNx+1`, `3NTS`, `4NS` (4NT by South),
`pass` / `p` / `-`.

Strain and declarer letters overlap (N, S), so strain is always taken first and
greedily: `4NS` is 4NT by South, `4SN` is 4S by North, `4NN` is 4NT by North.

The parse is echoed back canonically beside the field — **`4♥x by N, +1 · 11
tricks · NS +690`**. This matters: the board-tally check catches board-number
typos, but nothing catches `4Sx` typed for `4Hx`. The echoed score is the only
defence.

---

## Persisted round results

When a round closes the full result is computed once and stored:

```
r<n>|result → { computedAt, sourceDigest, status, validation,
                matchups: [ { teams, boards[], impsHome, impsAway,
                              vpHome, vpAway } ],
                teamVp, entryCount }
```

**Why persist, given compute is free.** `HGETALL` returns every entry in one
command and scoring 36 boards is microseconds — this is not a speed optimisation.
The value is a durable audit record. Without it, a later fix to the scoring engine
would silently restate rounds already played and agreed. The stored `boards[]`
also *is* the scoresheet, so rendering reads one field rather than re-deriving.

**Propagation.** Every mutation routes through one store function —
`writeEntries`, `deleteEntries`, `repointSegment` — which recomputes and rewrites
`r<n>|result` in the *same* write as the entry change. There is no path that edits
an entry without updating the result, because there is only one path.

**Self-healing.** `sourceDigest` is a SHA-256 of the round's sorted entries. On
read it is recomputed from the entries already in hand and, on mismatch, the
result is recomputed, persisted, and the discrepancy logged. An invalidation bug
degrades into a slow path, never into wrong VPs on screen — a silently stale
scoreboard is the one failure nobody would catch during a live tournament.

Dropping below a full card deletes the stored result rather than leaving it stale.

---

## Perspective toggle

A result is stored once, from the home team's side, but both tables are already
in it — so the away team's sheet is a pure rearrangement, not a second
computation. `flipMatchup` swaps the two orientations, moves each table across
and negates every figure. No refetch, and no second copy of the scores that
could drift out of step with what was scored.

It lives in `lib/tournament/perspective.ts` rather than `compute.ts` because a
client component must be able to import it, and `compute.ts` pulls
`node:crypto` for the digest. The import of `MatchupResult` there is
deliberately `import type`, which is erased at compile time.

`flipMatchup` is its own inverse, which is the property the tests pin down:
toggling back and forth can never drift.

---

## Storage

```
HASH g:<id>
  meta                            → { id, createdAt, teams, pairs }
  r<n>|<nsPair>|<ewPair>|<board>  → { contract, nsScore, updatedAt, clientId }
  r<n>|result                     → computed round result
```

- **Field-per-board removes the last write race.** Every write targets exactly one
  field, so two people at the same table entering different boards cannot collide
  and there is no read-modify-write of a shared blob. Storing a whole segment per
  field would reintroduce lost updates — and since entries have owners, a lost
  update is data loss.
- A six-row submit is a single `HSET` of six fields plus the recomputed result, so
  entry and downstream VP land atomically.
- `HGETALL` reads the whole game in one command, and the field names enumerate
  which segments exist. Since the app does not know the movement it *cannot*
  precompute keys — self-describing fields are required, not merely convenient.
- Max 112 fields, ~20 KB.
- Entries carry round, pairs and board in the **field name**, not the value, so
  the two cannot drift apart.

A narrow `Backend` interface has two adapters: `redisBackend` for production and
`fsBackend` (atomic temp-file rename, per-game promise-chain lock) writing
`data/games/<id>.json` for local development, so dev needs no external service.
The store selects one from the environment.

Game ids are 12 characters of Crockford base32 (~60 bits). On a public domain the
URL is the only access control, so it must not be enumerable.

---

## Structure as built

```
proxy.ts                            issues bt_cid on first contact
app/
  page.tsx                          create game (3 teams × 2 pairs × 2 players)
  actions.ts                        server actions: create, save, delete, repoint
  g/[gameId]/layout.tsx             header, nav, session code
  g/[gameId]/page.tsx               standings, round status, share link
  g/[gameId]/round/[round]/page.tsx pair dropdowns + segment entry
  g/[gameId]/results/[round]/       scoresheets, matchup IMPs/VPs, round VP
lib/
  bridge/    score.ts imps.ts vp.ts contract.ts
  tournament/ matchups.ts validate.ts compute.ts setup.ts
  store/     index.ts backend.ts redis.ts fs.ts
  visibility.ts  what one client may see of one round
  forms.ts       isClaimedByOther, parseSegmentRows (pure, tested)
  session.ts cookies.ts ids.ts types.ts
components/
  SegmentForm PairPicker Scoresheet Standings
  ValidationBanner RefreshButton ShareLink SessionCode
__tests__/  bridge tournament store forms setup + fixtures
```

---

## Deviations from the approved plan

**1. Server Actions instead of API route handlers.** The plan listed
`app/api/...` routes. Server components already read the store directly, so
routes would have been a second, redundant path to the same data — and a second
place for the visibility filter to be got wrong. The store's single write choke
point is unaffected.

**2. `proxy.ts` instead of `middleware.ts`.** Next 16 renamed the concept;
applied via the official codemod to avoid shipping a deprecation. `CLIENT_COOKIE`
lives in `lib/cookies.ts` so the Edge-runtime proxy and server components can
share it without pulling in each other's imports.

**3. `outputFileTracingRoot` pinned** in `next.config.ts`. Without it Next walks
up to the nearest lockfile, which on a dev machine can be the home directory.

**4. `LocalTime` client component** for the "Scored at" timestamp — see the
hydration bug below.

**5. Two extra pure modules** — `lib/forms.ts` and `lib/tournament/setup.ts` —
extracted so form-row semantics and game creation are unit-testable rather than
trapped inside server actions.

---

## Verification performed

**110 unit tests**, all passing.

- Every row of `example_scoresheet.png`: 17 contract scores and 9 IMP conversions,
  including vulnerable rows (`6S+1` = 1460, `5D+2` = 640, `5Hx-2` = −500) and NV
  doubled (`2Dx-3` = −500).
- Boundaries: `1C-1`, `7NTxx=` (2280 NV), `4Hx+1` (690 NV), doubled undertrick
  escalation, passed out, doubled partscore vs game at exactly 100.
- Parser: spacing/casing/double-placement variants, N/S strain-declarer overlap,
  malformed input rejected.
- Matchups: a realistic round following the true movement resolves to three
  matchups of six paired boards, twelve boards per pair.
- Validation: every error class detected and naming the offending segments.
- **Visibility filter tested as a pure function** — the security-relevant unit,
  asserting a masked entry has exactly the keys `board, ewPair, masked, nsPair,
  round` and no scoring data.
- Result propagation: edit, delete and repoint each reach `teamVp`.
- Digest self-heal: a hand-tampered stale result is recomputed *and* rewritten.

**End-to-end against a running production build**, via HTTP and a real browser:

| Check | Result |
|---|---|
| Create tournament through the real form | Redirects to `/g/<id>`, teams render |
| Enter a segment, live score echo | `4♥ by N, = · 10 tricks · NS +420` etc. |
| Mid-round hiding at 35/36, **payload inspected** | Stranger got 6 board numbers, **zero** occurrences of `nsScore`, `clientId`, any contract or any VP field |
| Masked rows | 6 rows, both inputs disabled, take-over offered |
| Take-over transfers ownership | Board 13 → requester at 1860; other five untouched |
| Close round, scoresheets | Matches `example_scoresheet.png` column for column |
| Edit a closed round | IMPs 19–7 → 7–11, VP 13.24 → 8.92, standings reordered |
| Board typo | Both segments named, boards 5 and 16 excluded, banner clears on fix |
| Changing pairs resets the form | Rows, unsaved text, taken-over boards and save message all clear; masked state recomputed for the new segment |
| Perspective toggle, clean production build | Caption, block headers, IMP columns, VP and every board mirror; each matchup toggles independently |
| Bad/unknown/lowercase game id | 404 |
| `bt_cid` issued on first contact | Yes |

### Bugs found by the browser that the other layers missed

**Hydration failure killed all interactivity on the results page.**
`new Date(result.computedAt).toLocaleString()` resolved differently on the two
sides — Node chose `en-SG` (`6:22:11 pm`), the browser `en-GB` (`18:22:11`), on
the same machine. React discarded hydration, so every button on that page was
inert, including Refresh. It went unnoticed because the earlier end-to-end pass
only *read* content from the results page and never clicked anything there.

Fixed with `components/LocalTime.tsx`: first render is a deterministic UTC
string both sides agree on, upgraded to local formatting in an effect after
mount. `negate()` in `lib/types.ts` addresses the same class of problem for
data — `-0` from negating a drawn board survived in memory but became `0`
through JSON, so a freshly computed round did not deep-equal the same round
reloaded.

**Stale form state survived a change of pairs.** `SegmentForm` seeds its rows
from props in a `useState` initializer, which only runs on mount. Changing the
dropdowns re-rendered the server component with new seeds, but React reused the
instance, so the previous segment's typed rows, taken-over boards and save
message all carried over. The visible symptom was the least harmful part: a
board unlocked by *enter it myself* stayed unlocked against a different table,
where it could overwrite another client's entry with no explicit take-over.

Fixed by keying the form on `round|nsPair|ewPair` so React remounts it when the
segment changes, which resets all three pieces of state at once.

*Lesson applied:* verifying a page by reading its HTML does not verify that the
page works. Interactive elements have to be clicked — all three of these bugs
were invisible to the unit tests and to HTTP-level checks.



Disabled inputs are not submitted. Masked rows were posting a board number with
**no** contract, so the server rejected the whole save as "Contract required" —
meaning a player could never take over a single board while the others stayed
masked. Neither curl nor the unit tests exercise browser form semantics.

Fixed by disabling **both** inputs on a masked row, so the row is skipped
entirely. Locked in by extracting `isClaimedByOther` and `parseSegmentRows` as
pure functions with regression tests.

---

## Deployment

1. Import the repo into Vercel.
2. Storage → Create → **Upstash Redis** from the Marketplace.
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are injected
   automatically; the app switches to Redis as soon as both are present.
3. Deploy.

Serverless filesystems are ephemeral, which is why production uses Redis rather
than files. Locally, with no credentials set, games are JSON under `data/games/`.

---

## Appendix — offline movement (not built)

Out of scope by decision: the app does not direct the movement. Recorded here
because it was worked out during design and is useful for running the day.

A whole round is determined by **one bit per team** — which of its two pairs sits
NS. With NS staying put, EW moving `t → t−1` and boards moving `t → t+1`:

| Table | NS (both halves) | EW half 1 | EW half 2 |
|---|---|---|---|
| 1 | `A[nsA]` | `B[other(nsB)]` | `C[other(nsC)]` |
| 2 | `B[nsB]` | `C[other(nsC)]` | `A[other(nsA)]` |
| 3 | `C[nsC]` | `A[other(nsA)]` | `B[other(nsB)]` |

Each cross-team group (A×B, A×C, B×C) has four possible pairings but a round only
ever uses two, and *which* two depends solely on whether the two teams' NS indices
match. So over three rounds the best achievable is: all twelve cross-team pairings
occur, six of them twice. This rotation achieves that **and** gives every pair a
2–1 NS/EW split:

| Round | A | B | C |
|---|---|---|---|
| 1 | A1 | B2 | C2 |
| 2 | A2 | B2 | C1 |
| 3 | A2 | B1 | C2 |

Round 1 is the worked example from `plan.md`.
