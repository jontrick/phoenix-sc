# PHOENIX — PASTE THIS INTO ANY NEW OR RESUMED CHAT

Paste the block below verbatim. It is the whole onboarding. Replace `<DOMAIN>` with
**PM**, **TRAINING**, **NUTRITION** or **PEPTIDES**.

---

```
You are the <DOMAIN> chat on Project Phoenix, working in ~/Desktop/phoenix-sc.
Jon is a non-technical solo founder. He tests on his phone at 4:30am.

DO THIS BEFORE ANYTHING ELSE — before reading, before proposing, before building:

  node board_check.mjs

Then read, in this order:
  1. CLAUDE.md          the rules. They override your defaults.
  2. KNOWN_ISSUES.md    the traps, and the mechanism that hid each one
  3. OPEN_ITEMS.md      the single list of open threads
  4. COMMS_PROTOCOL.md  how the chats work together — binding on every session
  5. HANDOFF_<DOMAIN>.md   your brief. READ IT LAST AND TREAT IT AS POSSIBLY BEHIND
                           THE BOARD. It is a narrative; the board is measured.

Then tell me what you found before proposing what to build.

If you are not the PM: EnterWorktree {name:"<domain>"} before touching any file.
Never edit ~/Desktop/phoenix-sc/index.html directly unless you are the PM.

RE-RUN board_check.mjs ON EVERY WAKE, not just at startup. A resumed chat is
answering from a photograph — this repo has moved ten versions inside one idle gap.

Nothing ships without all four gates green, chained with && so a red one blocks:
  node runtime_check.mjs && node harness.mjs && node functional_check.mjs && node version_check.mjs
```

---

## Why the order is what it is

**The board first, and it holds nothing.** A chat's memory has no staleness signal —
nothing announces that it has drifted. The PM's board once reported two features as open
hours after both had shipped, and was corrected only because a peer happened to mention one
while reporting something else. `board_check.mjs` reads `origin/main`, fetches first, and
ends by telling you that if it disagrees with a chat, **the chat is wrong** — including the
PM.

**The narrative last.** `HANDOFF_*.md` files are written by hand and go stale silently. The
board is derived in ten seconds and cannot.

**On wake, not just at start.** Sessions end without warning, peer names rotate — six
rotations in one day here — and `SendMessage` has been unavailable mid-session. The only
thing that reliably survives a session ending is a file on disk.

## The one rule that is easiest to skip and costs the most

**R-REC1 — WRITE THE FINDING TO THE RECORD FIRST, THEN MESSAGE.**

A finding goes into `KNOWN_ISSUES.md` or `OPEN_ITEMS.md` first. The message then says where
it is. Messaging is for *"you are unblocked, go"* and for claiming a shared file.

*If you would be annoyed to lose it, it does not belong only in a message.*

And note what does **not** count as the record:
- **A code comment.** Comment for the next editor of that file; record for the next person
  with the question. A trap here was written up well, in the right file, and still cost a
  full rediscovery.
- **A commit message.** Durable but undiscoverable — nobody greps 260 commits for a trap
  they do not know exists.
- **A scratchpad path.** It reads like a real path in prose and is gone within the hour.

## What each file is for — one job, one place

| file | job |
|---|---|
| `CLAUDE.md` | rules that override the assistant's defaults. Loaded automatically. |
| `COMMS_PROTOCOL.md` | how the chats work together — isolation, gates, ownership, comms |
| `KNOWN_ISSUES.md` | traps in this codebase, and what hid each one |
| `OPEN_ITEMS.md` | the single list of open threads, plus a `???` gaps section |
| `HANDOFF_*.md` | per-domain brief — narrative, read last |
| `board_check.mjs` | derives current state. Holds nothing. |

**ONE LIST.** A thread recorded in two places goes stale in one, and nothing announces it.

**Budgets: `OPEN_ITEMS.md` 300 lines, `KNOWN_ISSUES.md` 250.** The board warns past them.
Archive resolved threads out rather than leaving them in place — a control document nobody
finishes reading is one that lies about being read.

## The habits that catch the most here

- **Re-derive counts; never remember them.** And never read a gate's output through a
  truncating pipe and then trust the visible rows.
- **Publish the cut, not the bare number.** "41 sites" is not a fact; "41 sites matching
  write-or-upload within 14 lines of a console call, comments stripped" is.
- **Unknowns are `???`.** Never invent an owner, a date or a figure.
- **A check that has never fired is untested, not clean.** Break it, watch it go red — and
  confirm the inversion actually changed the file. A no-op inversion reads exactly like a
  passing guard.
- **Would this check be wrong in the same direction as the thing it checks?** If yes, it is
  the same claim twice.
- **Present is not enforcing.** `sw.js` existed and was zero bytes for 135 versions.
- **Do what was asked, then stop.** Anything else worth doing goes in `OPEN_ITEMS.md`.

## Not overstepping

- Confirm before anything hard to reverse: force-push, history rewrite, removing a
  worktree, schema changes, or any Supabase write outside the app's own code path.
- Never delete or reset another session's uncommitted work, even to clear a red gate.
  Copy it aside and say where you put it.
- `git checkout <file>` has destroyed uncommitted work three times in one day here, and
  **`git stash` is not the safe alternative** — the stash stack is shared across every
  worktree. Copy the file aside, or make a WIP commit.
