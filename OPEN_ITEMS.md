# OPEN ITEMS — the single working list

**SIZE BUDGET: 300 lines.** `board_check.mjs` warns past it. When you cross it, ARCHIVE
resolved threads out — do not leave them in place. A list nobody finishes reading is a
list that lies about being read.

**ONE LIST.** A thread recorded here *and* in a chat's context goes stale in the chat, and
nothing announces it. If it is open, it is here. If it is not here, it is not tracked.

**Never invent an owner, a date or a figure.** Unknowns are written `???`. A marked gap is
more useful than a confident guess.

Format: `- [ ] OWNER — the thread. What would close it.`
Closing an item: delete the line, or move it under ARCHIVE with the version that closed it.

---

## WAITING ON JON

- [ ] JON — Wake lock: does the screen still sleep on v4.9.264? Settings → Diagnostic now
      prints `screen wake lock` as `held` / `REFUSED: …` / `UNSUPPORTED`. Closes when he
      reports the line. Note: iOS Low Power Mode disables wake locks outright.
- [ ] JON — Peptide stock figures. PEPTIDES is blocked on these; it has no DB access and
      localStorage is on his phone, so Import/Export (v4.9.252) is the only route in.
- [ ] JON — Reconstitution: only `bpc157` is marked CONFIRMED BY JON. The other 16 entries
      in `_PEP_RECON` are transcribed from Peptide_Protocol_2026_27.pdf and unconfirmed
      against a real vial. Two have already been wrong in opposite directions. Closes
      compound-by-compound as he checks labels; each one confirmed should be marked in
      the source the way bpc157 is.
- [ ] JON — Should a live WALK and the WEEKLY CHECK-IN be restored after a screen lock?
      Both are deliberately in `_neverRestoreTabs` (v4.9.264) — a walk would imply one is
      running, and the check-in form reloads EMPTY so returning to it invites a second
      submission. His call; PM will wire either properly if he wants it.

## OPEN — REPO / TOOLING

- [ ] ??? — The `training` worktree has UNRESOLVED MERGE CONFLICTS (`UU` on harness.mjs,
      index.html, sw.js), found by board_check on 2026-09-04. Either a live TRAINING
      session is mid-rebase, or one died in one. NOT touched — it may be live work.
      Whoever owns that session: finish or abort the rebase. Closes when the worktree is
      clean.
- [ ] ??? — `nutrition` worktree is on 4.9.254 and `peptides` on 4.9.263 while origin is
      4.9.264. Stale checkouts are how one chat ships another's old code. Each domain
      pulls before its next build.
- [ ] PM — `.git` was deleted from the main checkout on 2026-09-04, orphaning all three
      worktrees. Restored from a fresh clone and worktrees re-registered; nothing was
      lost (verified byte-for-byte against origin). CAUSE UNKNOWN — `???`. Reopen with
      evidence if it recurs. Worktrees are now on detached HEADs because the branch
      bindings lived in the deleted directory.

## ??? — GAPS. Things nobody currently knows.

- `???` What killed `.git`. No candidate identified.
- `???` Whether the wake lock has EVER been granted on Jon's device. The outcome was
  swallowed by a bare `catch(e){}` from v4.9.118 until v4.9.264, so there is no history.
- `???` Which domain chats are live right now, and what each is mid-build on. Peer names
  rotate constantly (six rotations in one day) and `SendMessage` was unavailable to the
  PM on 2026-09-04. Derive from `board_check.mjs` CHECKOUTS, not from memory.
- `???` Whether the five other .236-corrected reconstitution defaults match his vials.

## ARCHIVE — closed, kept only where the closing evidence matters

- [x] Auto-update after the zero-byte `sw.js` — **CONFIRMED WORKING**, v4.9.252. Jon
      answered directly that the version at the bottom of Today moves on its own after a
      normal open. Closed a claim that sat UNVERIFIED from v4.9.208.
- [x] Coach-worker vision passthrough — **VERIFIED**, 2026-08-22, by posting a synthetic
      report with unguessable values and getting all four back exactly.
