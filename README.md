# Bridge tournament scorer

Scoring for a single in-house tournament: three teams of four, three rounds of
duplicate IMPs teams, victory points. All boards are non-vulnerable.

## Running locally

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 110 unit tests
```

With no Upstash credentials set, games are stored as JSON under `data/games/`,
so local development needs no external service.

## Deploying

The app is built for Vercel.

1. Import the repo into Vercel.
2. Add **Upstash Redis** from the Vercel Marketplace (Storage → Create).
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are injected
   automatically; the app switches to Redis as soon as both are present.
3. Deploy. The free tier is far beyond what twelve players generate.

Serverless filesystems are ephemeral, which is why Redis rather than files is
used in production.

## How it works

The app tracks **scores only** — it does not direct the movement. Who sits
where is arranged offline; players record which two pairs played each set of
boards, and everything else is derived.

- **Segment** — six boards played between two pairs in one orientation,
  keyed `(round, nsPair, ewPair)`. A round is six segments, 36 boards.
- **Matchup** — derived from the teams the two pairs belong to. Each 6-board
  set is played twice by the same two teams in opposite orientations, so the
  two halves find each other without any model of the movement.
- **Scoring** — for the home team, `difference = nsScore + ewScore` across the
  two orientations, converted with the standard IMP table, then to victory
  points on a continuous 20-VP scale blitzing at 37 IMPs (`round(15·√6)`).

### Board numbers are validated, not assigned

Players type board numbers, because the numbering can change on the day. The
movement guarantees that the two halves of a matchup cover the *same* six
boards, so a typo shows up as an unmatched board on exactly one side and is
reported by name. Unmatched boards are excluded from the IMPs rather than
silently scored.

### Visibility

While a round is open, you see only the boards you entered yourself. Other
entries appear as a board number and nothing else — enough to make duplicate
entry impossible, not enough to reveal a result. Filtering happens on the
server, so hidden data is never sent to the browser.

Identity is an anonymous `clientId` cookie, mirrored to localStorage and
shown as a recovery code. Losing it hides your own entries only until the
round closes, after which everything is public and editable.

## Layout

```
lib/bridge/        contract parsing, scoring, IMPs, victory points
lib/tournament/    matchup derivation, validation, round computation
lib/store/         one Redis hash per game, one field per board
lib/visibility.ts  what one client may see of one round
app/               landing, standings, entry, results
```

Every mutation funnels through one store function that recomputes and rewrites
the round result in the same write, so an edit always reaches the victory
points. A `sourceDigest` on the stored result is checked on read and repaired
if it does not match the entries.
