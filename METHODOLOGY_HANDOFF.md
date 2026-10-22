# BUILDING A PWA WITH MULTIPLE AI CHATS — WHAT PHOENIX LEARNED

**For: the work-processes PWA project lane.**
Written 2026-10-22 from Phoenix at **v4.9.340, 767 commits**. Figures below were derived
from the repo on that date, not recalled.

Phoenix is a single-file iOS PWA built by four Claude chats working in parallel on one
codebase. This document is what survived. It is in three parts, and **the split matters
more than the content**:

| | |
|---|---|
| **§1–3 COPY ON DAY ONE** | the method, and iOS platform facts that are free to you |
| **§4 EARN, DO NOT COPY** | the trap library. Yours starts EMPTY. |
| **§5 SKIP** | until you hit the problem it solves |
| **§6 WHERE PHOENIX GOT IT WRONG** | two of its own rules are currently broken |

**Reference files:** all paths below are under `~/Desktop/phoenix-sc/`. §7 is the map.

---

## 1. THE ONE IDEA EVERYTHING FOLLOWS FROM

> **COORDINATION BETWEEN AI SESSIONS IS A DURABILITY PROBLEM, NOT A COMMUNICATION PROBLEM.**

Sessions end without warning. Peer names rotate — six rotations in one day, measured.
The messaging tool itself vanished mid-session, twice, for different chats. Every single
time, the thing that survived was **a file on disk**.

So the system is not built around how chats talk. It is built around what outlives a chat.

**The failure that proved it:** a finished, fully tested fix sat unpushed in a half-finished
rebase because the session ended mid-operation. It was the third report of the same bug. It
survived only because that chat wrote its state to a file before stopping, and a human
carried the file across. A chat that had only *messaged* its status would have lost it.

**The rule that falls out of it — the single highest-value thing in this document:**

> **R-REC1 — WRITE THE FINDING TO THE RECORD FIRST, THEN MESSAGE.**
> Messaging is for *"you are unblocked, go"* and for claiming a shared file.
> **If you would be annoyed to lose it, it does not belong only in a message.**

And what does **not** count as the record:
- **A code comment.** Comment for the next editor of that file; record for the next person
  with the question. A trap was written up well, in the right file, and still cost a full
  rediscovery because a comment is invisible to anyone not already in that file.
- **A commit message.** Durable but undiscoverable. Nobody greps 767 commits for a trap
  they do not know exists.
- **A scratchpad path.** It reads like a real path in prose and is gone within the hour.

---

## 2. COPY ON DAY ONE — THE METHOD

### (a) A DERIVED BOARD. Highest value by a distance.

`board_check.mjs` — **107 lines, and it holds nothing.** One command prints measured state
in about ten seconds: version on the remote, every checkout with its branch and whether it
is behind, what shipped per lane, and the open list with a staleness warning.

Rules it obeys, each of which cost a real error:
- **Reads the remote, never the working tree.** A checkout sits on whatever was last used.
- **Fetches first.** A stale ref makes every line below it a lie.
- **Read-only. Names and presence, never secret values.**
- **It reports on its own staleness** — `last WRITTEN <commit>, N commits since`.
- It ends with: *"Source of truth is the repo, the live app and the database. Not this
  script, not any chat. If a figure here disagrees with something a chat told you —
  INCLUDING THE PM — the chat is wrong."*

**Why:** a chat's memory has no staleness signal. Nothing announces that it has drifted.
Phoenix's coordinating chat reported two features as open hours after both had shipped, and
was corrected only because a peer happened to mention one while reporting something else.

**It earned itself on its first run** by finding an unresolved merge conflict sitting in
another chat's workspace that nobody had reported.

### (b) A FIXED STARTUP ORDER — AND RE-RUN IT ON WAKE

Board first, before reading anything, before proposing anything. Then rules → traps →
the working list → the protocol → the lane's own brief, **narrative last and explicitly
labelled possibly behind the board.**

**Re-run on wake, not just at startup.** A resumed chat answers from a photograph. Phoenix
moved **sixty versions inside one four-day gap**; the coordinating chat woke up stale and
only knew because it ran the board first.

`SESSION_START.md` is the paste-in prompt. Copy its shape.

### (c) FOUR FILES, ONE JOB EACH, AND ONE LIST

| file | job |
|---|---|
| `CLAUDE.md` | rules that override the assistant's defaults. Loaded automatically. |
| `COMMS_PROTOCOL.md` | how the lanes work together — isolation, gates, ownership |
| `KNOWN_ISSUES.md` | traps, and **the mechanism that hid each one** |
| `OPEN_ITEMS.md` | the single list of open threads, plus a `???` gaps section |

> **ONE LIST.** A thread recorded in two places goes stale in one, and nothing announces it.

This is not theoretical. A lane kept a summary of its own handoff outside the repo; it
diverged from the canonical file and only the repo one was right. The coordinating chat
nearly committed the stale summary over the good document.

### (d) GATES THAT EACH CATCH WHAT THE OTHERS CANNOT

Four, run chained with `&&` so a red one actually blocks. Phoenix's are
`runtime_check` · `harness` · `functional_check` · `version_check`, currently
**6/6 blocks at 100% coverage, 1072 static assertions, 1319 functional tests.**

**The shape is what transfers, not the tooling:**
1. **Does it parse and does its top level run?** Cheap, catches syntax and load-order.
2. **Static assertions** — strings and structures that must exist, or must never come back.
3. **Call the real functions** in a sandbox. This is the one that catches logic.
4. **Is the thing you are about to ship actually the thing you tested?**

**Gate 1 and 2 cannot see inside a function body.** An undefined reference inside a
callback passes both. A renderer called a function whose real name had no underscore —
parse clean, assertions green, 43 functional tests green, because they tested the helpers
and never the renderer. **The feature had never once run, for four versions.**

> **Functional tests must invoke the entry point that draws the screen, not only its
> helpers. "Live" means executed, not present in the file.**

Gate 4 exists because two chats shipped the same version number twice. The check reads
**the staged commit, not the working tree** — a version check that reads the working tree
once printed CLEAN about a file that was not in the commit.

### (e) ISOLATION — ONE WORKSPACE PER LANE, MANDATORY

Each lane gets its own git worktree. A shared working tree caused one chat's `git add` to
ship another chat's unchecked code. Non-negotiable after that.

### (f) THE NUMBERS AND VERIFYING RULES

These are in `CLAUDE.md` under **NUMBERS AND CLAIMS** and **VERIFYING**. Copy them
verbatim; every one is a scar.

- **Never publish a figure without the population it was cut from.** "24 write paths" was
  really **41** — one search covered `console.warn` and not `console.error`.
- **Never invent an owner, a date or a figure.** Unknowns are `???`.
- **Re-derive counts, never remember them** — and never read a gate's output through a
  truncating pipe and then trust the visible rows. That turned twelve findings into seven.
- **Verify against the source, not a second derivation.** *If the thing I am testing is
  wrong, would this check be wrong in the same direction?* If yes it is the same claim
  twice. A scan written to confirm a bug report carried the identical defect, returned the
  answer its author wanted, and had no way to return another.
- **A check that has never fired is untested, not clean.** Break it, watch it go red — and
  **confirm the break actually changed the file**, because a no-op inversion is
  indistinguishable from a passing guard. That happened twice in one day.
- **An instrument reports on its proxy, not its subject.** Present is not enforcing.
- **When you supersede a claim, DELETE it.** A rules file asserted both "a manual reinstall
  is still required" and "auto-update is confirmed working" on adjacent lines. Two lane
  handoffs, written weeks apart, each copied the stale half. *A contradiction in a source
  document does not produce one confused reader — it produces several confident ones,
  disagreeing.*

---

## 3. iOS PWA PLATFORM FACTS — THESE ARE FREE TO YOU

**This section is the exception to "earn it".** These are not Phoenix's bugs; they are
properties of the platform, and they will bite any PWA used on a phone. Phoenix spent
hundreds of versions finding them.

### `alert()`, `confirm()` and `prompt()` DO NOT WORK. Build DOM modals.
iOS suppresses them silently in an installed PWA. Worse than silent: **a suppressed
`confirm()` returns false**, so `if(!confirm(x)) return;` always returns and the feature is
*dead*, not merely quiet. "Reset my programme" never worked once on the user's phone.

**And a failure path whose only output is an `alert()` shows nothing and then returns.**
Twelve such paths existed — including onboarding's main button and the diagnostic screen's
own self-test, which reported neither success nor failure on the one screen that exists to
explain failures. **Each looked exactly like a dead button.**

### THE SERVICE WORKER CAN EXIST AND BE EMPTY
`sw.js` was **zero bytes from v4.9.74 to v4.9.208 — 135 versions.** The update machinery in
the app was complete and correct the whole time, and was registering an empty script. **No
deploy reached the phone automatically for four months.** Every "hard refresh to pick this
up" was wrong, and the standard advice — bump the version again — only masked it.

> **Present is not enforcing.** Assert the service worker's *content*, and pin its version
> to the app's version with a gate. And put the version on a screen the user can read, so
> "did my change arrive" is answerable by looking.

### THE KEYBOARD COVERS YOUR INPUTS, AND HALF A FIX IS WORSE
Bottom sheets need sizing against `visualViewport`. Phoenix's first fix handled the sheet
but not panels sized in viewport units, so the overflow went off the **top** of the screen
— inputs gone, save button still visible. **Guard it as a rule enumerated from the source,
not as a list of known sheets**, so a sheet written next month is covered before it exists.

### DAY KEYS MUST BE LOCAL, NEVER UTC
`toISOString().slice(0,10)` is UTC. The user trains at 04:30 in UTC+10, so every morning's
work filed under the previous day. One shared helper, used everywhere.

### A HANDLER THAT HARDCODES "TODAY" IS INVISIBLE UNTIL THE SCREEN CAN SHOW ANOTHER DAY
Every write assumed today. The moment the screen could show another day, a tick on Monday
landed on today — **silently**, corrupting records with nothing to surface it. If a screen
will ever show a date other than now, thread the date through the **writes** from the start;
the reads are the easy half.

### THE CONSOLE DOES NOT EXIST ON THE PHONE
`console.warn` and `console.error` are both invisible in an installed PWA. A failed cloud
write that reports only to the console fails with **nothing on screen and nothing anywhere
else**. Route every write failure through one helper that records it somewhere the user can
open, and **have that helper redact inside itself** — store the payload's *shape*, never its
values — so correctness does not depend on every caller remembering.

**And then display it.** Phoenix collected failures into a ring buffer for 60+ versions that
**no screen ever read.** Four lanes spent a day designing a rationing scheme for slots in a
buffer nobody could open.

### LOCAL STORAGE IS ~5MB AND SHARED
A few full-size photos evict everything. The user experiences that as *"my recipes
vanished"*, not as a storage problem. Downscale, and do not persist images you can re-read.

### LOCAL-FIRST, THEN MIRROR — WITH ONE EXPLICIT CONFLICT RULE
Write locally, mirror to the cloud, and decide **newest-wins by an explicit timestamp**
stamped on write. Not "whichever arrived last". A reinstall is routine, so a silently
failing mirror plus a reinstall is total loss.

---

## 4. ⛔ EARN THESE. DO NOT COPY THEM.

**`KNOWN_ISSUES.md` STARTS EMPTY, and that is correct.** Phoenix's 23 entries each describe
a specific trap that cost this project real time, with the mechanism that hid it. Copying
them into your project is cargo cult — they describe another system's failure modes, they
will not match yours, and **a file of borrowed warnings trains people to skim it**, which
costs more than the file saves.

Day one: an empty file with one line at the top.

> *Every entry here cost a real error. Record THE MECHANISM THAT HID IT, not just the fix.*

Same for most of `COMMS_PROTOCOL.md`. It is 395 lines of rulings about *this* app. Perhaps a
tenth transfers, and that tenth is in §2 above.

**Read Phoenix's `KNOWN_ISSUES.md` once, for the shapes.** Then close it and write your own.

---

## 5. SKIP UNTIL YOU HIT THE PROBLEM

| thing | only worth it when |
|---|---|
| Per-lane brief files | 3+ parallel chats on genuinely separable domains. At two it is overhead. |
| A dated-handoff habit | sessions are dying mid-thought. Phoenix's exist because that happens. |
| Numbered, citable rules | you are citing rules across chats often enough that names are slow. |
| A separate narrative/state doc | the board plus the commit log covers it for a long time. |

> **Ceremony that will not be sustained is worse than nothing. A process nobody follows is a
> process that lies about being followed.**

---

## 6. ⚠️ WHERE PHOENIX'S OWN IMPLEMENTATION IS CURRENTLY BROKEN

Stated plainly, because copying the mistakes would be easy.

- **`OPEN_ITEMS.md` is 572 lines against its own 300-line budget** — nearly double, with 40
  open threads. The board warns on every run and the warning has been ignored for weeks.
  **Budget a size limit on day one and archive resolved threads out rather than leaving
  them in place.** This is the clearest failure of the implementation.
- **`KNOWN_ISSUES.md` is 425 lines against a 250 budget.** Same drift, same cause.
- **`COMMS_PROTOCOL.md` is 78KB.** It has not been split because it is still being read —
  which is the right test — but it is close.
- **Four control documents are now ~170KB and every chat reads a slice at startup.** That
  cost only pays back with several parallel chats on a shared codebase where drift is
  expensive. **With one or two chats, do §2(a), §2(b), §2(c) and §2(f) and nothing else.**

---

## 7. THE FILE MAP — WHAT TO OPEN, IN ORDER

All under **`~/Desktop/phoenix-sc/`**.

### Read these, in this order
| path | lines | why |
|---|---|---|
| `SESSION_START.md` | 148 | **Start here.** The paste-in prompt and the reasoning. Shortest useful thing in the repo. |
| `board_check.mjs` | 107 | The derived board. Small enough to read in full; copy its rules. |
| `CLAUDE.md` | 389 | Rules. §NUMBERS AND CLAIMS, §VERIFYING and §SCOPE transfer verbatim. The PWA and Supabase sections are Phoenix-specific. |
| `KNOWN_ISSUES.md` | 425 | Read **once, for the shapes.** Then close it and start your own empty. |
| `COMMS_PROTOCOL.md` | 395 | Skim. Isolation and the testing standard transfer; the rest is domain. |

### The gates — copy the shape, not the code
| path | lines | what it does |
|---|---|---|
| `runtime_check.mjs` | 181 | Runs every inline script block's top level in a `vm` sandbox. |
| `harness.mjs` | 4008 | Static assertions. **Do not read end to end** — grep it. |
| `functional_check.mjs` | 245 | The runner that calls real functions. **This is the one to copy.** |
| `version_check.mjs` | 120 | Reads the staged commit, refuses a version collision. |
| `tests/pm.mjs` | 20KB | **The best worked examples.** Small. Read this, not the 280KB lane suites. |

### Do not start here
| path | why not |
|---|---|
| `index.html` | 2.5MB, 44,694 lines, single file. An artefact of how Phoenix grew, **not a recommendation.** Your project should be multi-file from day one. |
| `OPEN_ITEMS.md` | 572 lines of live threads about someone else's app. |
| `tests/{training,nutrition,peptides}.mjs` | ~900KB total. Grep for a pattern; never open whole. |
| `HANDOFF_5.md` | 48KB original build spec, historical. |

---

## 8. HALF A DAY TO THE MINIMUM VIABLE VERSION

1. **A board script.** Derive your real state in one command — version, remote tip, every
   checkout and whether it is dirty or behind, deploy state. End it with the *"if a chat
   disagrees with this, the chat is wrong"* line. **Add the staleness signal from the start.**
2. **A rules file** — §2(f) plus your own safety boundaries: what always needs confirmation
   (pushes, deploys, anything writing to a system of record).
3. **An empty traps file**, with the one-line instruction.
4. **An empty open-items file**, with a `???` gaps section and the size budget written at
   the top.
5. **A paste-in startup prompt** — board first, then the files in order, then *"tell me what
   you found before proposing what to build."*
6. **Two gates minimum**: does it load, and does the thing the user taps actually run. Add
   the other two when you feel their absence.

Add briefs, handoffs and a narrative doc **only when you feel their absence.** Every one of
Phoenix's exists because something went wrong without it — which is the right reason to add
one, and the wrong reason to copy one.
