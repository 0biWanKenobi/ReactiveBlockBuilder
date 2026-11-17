# Smaller optimization findings: completed evaluation batch

Measured **2026-11-18, Europe/Rome**, baseline **`5cf3923`**. C1 was excluded.
This batch finishes U7, U8 and C6 before starting larger work. Production code
is unchanged; candidates live in `scripts/experiments/small-items/patches.mjs`.

**No broadly perceptible speed or important memory improvement was established.**
U7 does show a real, modest export-time improvement when there are many fields.
U8 is maintenance only. C6 removes geometry reads without a useful measured
drag-latency improvement on these cases.

## Scope and remaining work

| ID  | Evaluation status                                                            | Decision for the performance objective                                                                                                |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| U7  | Production-browser before/after, allocations and work-count control          | Reasonable one-line cleanup; modest export-only benefit, strongest in a large-field sensitivity case                                  |
| U8  | Production bundle comparison and reference search                            | Maintenance only; identical shipped JavaScript                                                                                        |
| C6  | Production-browser before/after in two layouts, work counts and actual drops | Defer; no demonstrated perceptible or retained-memory benefit                                                                         |
| U6  | Source triage only                                                           | Sharing types/forms does not remove the two owners' event subscriptions or rendered inspector instances; keep as maintainability work |
| C5  | Source triage only                                                           | A lifecycle helper still mounts/updates/unmounts one component per atom; no avoided runtime work demonstrated                         |
| C4  | Source triage only                                                           | Primarily policy consistency; a targeted validation-allocation probe would still be needed to quantify its small-array aspect         |
| C2  | Not evaluated in this batch                                                  | Live synchronization with mostly unrelated instances remains an open performance candidate                                            |
| C3  | Not evaluated in this batch                                                  | Full creation/drag allocation chains still need measurement                                                                           |
| U5  | Not evaluated in this batch                                                  | Typing into one CSS section with substantial unrelated CSS still needs a browser comparison                                           |
| C7  | No new evaluation                                                            | Earlier Bun microbenchmark evidence remains; incremental protection has not been prototyped                                           |
| C8  | Not evaluated in this batch                                                  | Needs a real large-library use case; this batch supplies no indexing evidence                                                         |

The source-only rows are assessments of the proposed mechanism, not measured
before/after wins or conclusive runtime rejections. No remaining item is silently
marked complete. The next batch can start with C2 or U5, reserving time to finish
one complete comparison rather than opening every remaining candidate.

## Method and case studies

The user explicitly authorized external browser automation for this evaluation,
overriding the embedded-browser requirement for this task. The repository policy
was not changed. Playwright drove **headless Microsoft Edge 157.0.4341.57** with
an isolated profile and **new browser process for every sample**. Hardware:
AMD Ryzen 3 3200G, four cores; Linux 7.3.3-1-cachyos x64; Bun 1.4.4.

Four production builds isolate baseline, U7, U8 and C6. Other findings are not
combined into their candidates. There are ten alternating paired rounds:
60 export samples and 40 drag sessions. No builds/tests ran during those timing
samples. Separate runs collect 18 allocation samples and six export work controls.
Pilot results are excluded. Unrelated external image requests use a fixed local
SVG response; no remote resource timing is included.

Export cases:

- **small-8:** one stock text block and eight formula fields; a small control.
- **smoke-238:** the reproduced Smoke Ball sheet, 770 document nodes and 238
  formula fields. Its unchanged eight-definition library is loaded too.
- **ledger-2048:** one stock text block and 2,048 formula fields, representing
  a formula lookup catalog. This is an explicit sensitivity/stress case, larger
  than Smoke Ball's field set; its canvas is deliberately simple.

Drag cases use simple stock text blocks without formula evaluation or custom
definitions: a **24-item vertical list** and a **240-card, six-column board**.
The latter tests sibling count rather than elaborate character-sheet structure.
Each fresh process records 16 clean-layout gap-entry events and 16 events over
the existing placeholder. Gap entries clear the previous preview and wait for
layout before measuring the next event. This does not simulate an entire human
mouse trajectory or every possible layout. The first event and all subsequent
events remain in the raw arrays; analysis uses each process's median, avoiding
treating its 16 events as independent browser runs.

Ten-pair bootstrap intervals below use 10,000 resamples of **paired differences**;
positive means faster after the change. They are exploratory, with small samples
and no human perception study. A small statistically detectable difference is
not automatically a perceptible interaction improvement.

## U7: remove the second export field clone

Only `structuredClone($state.snapshot(fields))` changes to
`$state.snapshot(fields)`. The snapshot/plain-data boundary remains.

The synchronous Sync-from-Preview handler measures snapshotting, serialization
and its state assignment. The two-frame interval additionally includes Svelte,
CodeMirror and browser rendering. It is a render-opportunity proxy, not a direct
measurement of presented pixels. All values are milliseconds.

| Case                   | Handler before → after | Paired handler improvement, 95% interval | Two frames before → after |
| ---------------------- | ---------------------: | ---------------------------------------: | ------------------------: |
| 8 fields               |            0.95 → 0.90 |                       0.05 [−0.05, 0.20] |             34.65 → 25.55 |
| Smoke Ball, 238 fields |            6.95 → 6.30 |                        0.70 [0.40, 0.90] |             51.95 → 50.70 |
| Ledger, 2,048 fields   |          30.35 → 24.50 |                        6.90 [4.10, 7.25] |             73.65 → 65.95 |

Differences between two marginal medians are not the paired estimate. For the
ledger the paired two-frame improvement is **7.20 ms [2.05, 13.85]**. The other
two cases' two-frame intervals include zero. Renderer task-duration intervals
also include zero in all three cases, so the noisy task medians must not be sold
as a CPU saving. The large-field case supplies a real latency signal, but no
human study established perceptibility; the actual Smoke Ball gain is under
one millisecond in the handler.

Separate controls confirm the complete field-map native clone is removed.
All exported field values are identical before/after, and the serialized export
stays unchanged after editing a live formula field. Primitive operations inside
Svelte's snapshot are outside the full-map clone count; they are not removed by
this candidate.

Retained JS heap after forced GC shows **no consistent benefit**: paired intervals
include zero for every case. Median before → after values are approximately
7.37 → 7.33 MiB, 10.21 → 10.20 MiB, and 11.66 → 11.67 MiB, respectively.

Allocation sampling, in a separate three-pair run per case at an 8 KiB sampling
interval, estimates whole-operation allocations of:

| Case       |     Before |      After |
| ---------- | ---------: | ---------: |
| 8 fields   |  0.516 MiB |  0.439 MiB |
| Smoke Ball |  4.939 MiB |  4.717 MiB |
| Ledger     | 10.938 MiB | 10.671 MiB |

These estimates include snapshotting, JSON and CodeMirror work, not just the
removed clone. Three-pair sampling is noisy, particularly for the ledger; its
paired allocation interval includes zero. Allocated bytes are not peak live heap
or RSS. This does not establish important memory-pressure reduction on an
explicit, occasional export. The U7 production build is 17 uncompressed JS bytes
smaller, which is immaterial to loading performance.

**Decision:** acceptable cheap simplification, with measured scaling by field
count. Do not promise noticeably faster ordinary sheets or a memory fix.

## U8: unused Button and private HtmlTag

The candidate deletes `Button.svelte`, the `HtmlTag` declaration and its unused
type import. No runtime replacements are introduced. Searches find no consumers;
the component is absent from the baseline client source maps.

The before/after production builds contain **16 JavaScript files, totaling
1,151,218 bytes**, with identical paths and SHA-256 hashes for every file. Removing
the unused component changes **zero shipped JS bytes**. There is consequently no
runtime speed/memory benefit from loading or executing that component in this
application: it is already absent. This does not measure package-source size or
build tooling maintenance, which are different concerns.

**Decision:** maintenance cleanup, not a performance priority. No artificial
runtime benchmark is assigned to code the app does not load.

## C6: reuse geometry within a drag calculation

The candidate passes the nearest child's already-read rectangle to the midpoint
decision and delays reading the source rectangle until after the existing
placeholder early return. Element/source validity checks remain. No persistent
geometry cache, frame coalescing or different drop policy is added.

| Case/path                   | Rectangle reads before → after | Handler before → after | Paired improvement, 95% interval |
| --------------------------- | -----------------------------: | ---------------------: | -------------------------------: |
| List, gap entry             |                        26 → 25 |         1.85 → 1.85 ms |             0.10 [0.00, 0.20] ms |
| Board, gap entry            |                      242 → 241 |        5.40 → 5.075 ms |            0.35 [−0.05, 0.50] ms |
| List, existing placeholder  |                          2 → 1 |         0.10 → 0.10 ms |               Approximately zero |
| Board, existing placeholder |                          2 → 1 |         0.10 → 0.10 ms |               Approximately zero |

Read-count instrumentation runs outside timing samples. Halving two reads is
not evidence of halving interaction cost. The board still scans its 240 siblings;
this candidate removes only one read. Timer resolution limits interpretation of
the roughly 0.1 ms early return. Retained-heap intervals include zero in both
layouts, and marginal differences are only about 1–2 KiB. The C6 build adds 55
uncompressed JS bytes.

Every before/after pair performs an actual drop and asserts matching target
positions and complete final document hashes, with placeholder cleanup. This is
focused canvas-drag coverage, not a replacement for palette/custom-node, scroll,
resize, modifier-key and nested-layout regression scenarios before shipping a
drag refactor.

**Decision:** defer on performance grounds for these cases. There is no evidence
here that the extra bookkeeping materially improves dragging or memory use.

## Evidence and repetition

- [Timing samples](timing-raw.json), [allocation samples](allocation-raw.json),
  [clone work controls](work-raw.json), [bundle evidence](build-evidence.json).
- `cases.mjs` constructs the simple cases and loads the canonical Smoke Ball
  example. No additional large fixture exports are versioned.
- `summary.json` is generated and ignored, using
  `bun scripts/experiments/small-items/summarize.mjs`.

Run from the repository root, with the relevant browser authorization:

```sh
bun scripts/experiments/small-items/build.mjs /tmp/svc-small-items
bun scripts/experiments/small-items/serve.mjs /tmp/svc-small-items
```

In another terminal, run the browser cases sequentially:

```sh
bun scripts/experiments/small-items/browser.mjs /tmp/timing.json 10 all
bun scripts/experiments/small-items/browser.mjs /tmp/allocation.json 3 allocations
bun scripts/experiments/small-items/browser.mjs /tmp/work.json 1 work
```

These commands require Playwright and an installed Edge channel. The build helper
restores all production sources even on failure; the servers bind only loopback
5180–5182. Close the benchmark server and remove temporary builds/results after
use. Move new samples into the documented raw-file structure only when deliberately
replacing an evaluation, then regenerate the summary. C1's embedded-browser data
used a different Chromium version; absolute times from the two reports should
not be compared as if they were a shared before/after experiment.
