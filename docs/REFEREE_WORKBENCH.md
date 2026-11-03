# Referee workbench — first local-only integration (2026-11-03)

Branch: `feat/referee-circular-workbench`, **stacked on open PR #14** (`feat/league-core-skill-sprint`).
This is a candidate, not a release, and makes no changes to club data or production.

## What is actually implemented

- Admin-only `/admin/referee` and discoverable admin navigation entry.
- Circular table on mobile and iPad, with host outside the table; Classic10 seats
  1/10 nearest the host, 5/6 farthest away. Short9 has exactly nine seats.
- New local protocol with explicit host and nicknames, private role entry, the
  exact imported v33 rules engine (no modifications to the legacy bytes).
- Setup, day/night transitions, shot or miss/unknown, Don/Sheriff observations,
  speech action, fouls, removals, nominations and vote stages, tied candidates,
  best move, explicit game finish, engine-enforced command validation.
- Independent timer with start/pause and 20/30/60 presets. Timer pauses on tab
  hide/lock; timing is not proof of a referee event and is not yet a certified
  complete regulation timer matrix.
- Append-only undo/redo, local auto-save, protected JSON import/export with
  SHA-256 and full protocol verification; Escape privacy cover and role masking.
- No database writes, no player ID inference, no cloud sync or result approval.

## Known gaps / no-go for real club use

1. No browser test under a real admin login or on a physical iPad/Safari yet.
2. No database sync or identity mapping to an evening/game; until implemented,
   results must be manually recorded in the existing admin interface.
3. No multi-device or multi-tab locking. Do not edit the same local protocol
   in parallel; export a JSON backup after each test session.
4. Local browser storage contains sensitive roles. Use only on the host's
   trusted device, and do not share exports of unfinished games.
5. No full RU/UK localization of this new screen yet; no final design review.
6. Full speech/last-word/night timing and edge-case UX need physical testing.
7. The old v33 engine's original rules and data are deliberately unchanged.

## Verification evidence

- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm run lint`
- `npm run typecheck`
- `npm test` (including table-position checks and frozen referee contract)
- `npm run build` attempted; **blocked on this executor** with
  `ENOENT: no such file or directory, uv_resident_set_memory`. Retried using
  `next build --webpack`, same environmental error. **CI build must pass** before
  this can be treated as an integrated build.

## Next independent engineering gate

1. GitHub Actions build for this branch; resolve only actual code failures.
2. Preview deployment against **test Supabase only**; verify server auth gate,
   local protocol restore/import, all phase scenarios on 375px and iPad portrait.
3. Add explicit admin review + player/host UUID mapping and versioned save to a
   test game, with conflicts/duplicate prevention, then physical Safari QA.
4. Translate all new screen text into Ukrainian alongside Russian before release.

**Never apply migrations to production, merge into main or change League Skill
as part of this UI-only candidate.**
