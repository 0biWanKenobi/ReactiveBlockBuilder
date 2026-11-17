# C1 on Smoke Ball: before/after, cold starts

Measured **2026-11-17, Europe/Rome**. **Defer the remaining C1 work for this
workload.** There is no demonstrated user-perceptible speedup or important CPU
or memory saving. Keep the name/CSS save gate and CSS cache update already in
`eb6371f`. The dependency-filtering candidate remains an experiment under
`scripts/experiments/c1/propagation.ts`; production saving is unchanged.

## Workload and implementation

The reproduction preserves the archive's six pages, 139 elements and 202 formula
properties, plus 36 roll fields. It uses only existing editor capabilities.
Screenshots showed that most elements are plain rows, headings and notes, so
pages and one-off equipment use stock containers. Eight custom definitions
remain: the seven exported templates and a shared property row. The document
has 770 JSON nodes; the entire definition library has only 63 nodes. No dummy
definitions or duplicated sheets were added.

An earlier 37-definition conversion was overmodeled. Its pilot measurements and
all protocol-development runs are excluded. Every reported sample uses the same
final eight-definition fixture. See [the reproduction](../../../examples/smoke-ball/README.md)
and `conversion.json` there for adaptations and the source archive SHA-256.

**Before:** `eb6371f`'s full-library structural-save loop. **After:** discover
direct dependencies on each structural save, stopping at custom roots; compute
transitive parents; snapshot/reconcile only that set in a single batch against
the candidate library; persist only differing results. No persistent graph,
changed validation, new editor features or C2 filtering. Both variants still
synchronize all outer live custom instances. This tests the complete remaining
C1 proposal, including sharing preparation's template cache across the batch.

## Browser results

Production builds in the VS Code embedded browser, Chromium 150.0.7871.250 /
Electron 43.8.6; Linux 7.3.3-1-cachyos x64; AMD Ryzen 3 3200G, four cores.
Bun 1.4.4 built and served the snapshots locally without HTTP compression.

**Ten paired runs per edit, 80 timing cold page loads, no save warmups.** Every
sample reseeds identical storage, navigates through `about:blank`, clears the
HTTP cache and loads a fresh document/JS realm with caching disabled. The existing
Definition import UI loads the sheet, then its first structural save is measured.
Before/after order alternates by round. No builds or unit tests ran during these
final timing samples. The renderer/browser process and OS filesystem caches are
not restarted; these are cold application documents, not machine/process boots.

Times below are medians in milliseconds. Close measures the actual Save click
through removal of the modal. Paint waits another two animation frames. Renderer
CPU is the CDP `TaskDuration` delta around the save and frames, including native
DOM/layout work and measurement-command overhead; it is not isolated C1 CPU.

| Structural edit               | Save closes, before → after | Two frames, before → after | Renderer task CPU, before → after |
| ----------------------------- | --------------------------: | -------------------------: | --------------------------------: |
| Shared property-row class     |               43.25 → 43.70 |              83.70 → 80.80 |                     86.83 → 86.34 |
| Journal-note class            |               29.90 → 29.20 |              49.30 → 47.05 |                     54.51 → 53.90 |
| Trait-note class              |               30.45 → 27.60 |              45.80 → 44.10 |                     49.18 → 54.87 |
| Add a slot to the note layout |               32.40 → 29.80 |              46.25 → 45.65 |                     51.92 → 51.88 |

Paired median improvements in Save closing time, with exploratory 95% bootstrap
intervals (10,000 resamples; positive means faster):

| Edit                 | Paired improvement | Bootstrap interval |
| -------------------- | -----------------: | -----------------: |
| Shared property row  |           −0.95 ms |  −2.70 to +1.70 ms |
| Journal note         |           +0.65 ms |  −1.15 to +4.05 ms |
| Trait note           |           +2.70 ms |  −1.35 to +5.70 ms |
| Note layout addition |           +1.55 ms |  +0.30 to +4.80 ms |

Only the layout-addition interval excludes zero, with a roughly 1.6 ms paired
improvement. This is measurable statistically, not evidence of a perceptible
change. Renderer CPU intervals include zero in every scenario. All measured
outliers are retained, including a 141.8 ms candidate property-row save.

Cold-load controls, also milliseconds:

| Following edit       | App/source editor ready, before → after | Sheet imported and two frames, before → after |
| -------------------- | --------------------------------------: | --------------------------------------------: |
| Shared property row  |                         493.70 → 492.15 |                               758.45 → 716.35 |
| Journal note         |                         521.15 → 496.65 |                               771.70 → 765.65 |
| Trait note           |                         526.80 → 480.70 |                               816.00 → 746.05 |
| Note layout addition |                         569.95 → 461.45 |                               803.50 → 713.75 |

These raw startup medians are noisy: all paired startup confidence intervals
include zero. Readiness includes polling/automation, and sheet-loaded time also
includes fixture fetch, CodeMirror replacement and the import UI. C1's save code
has not executed on these paths, so these controls do not establish a C1 loading
improvement. They should not be advertised as a startup speedup.

## Memory and fresh-process CPU

Retained JavaScript heap after Save and forced GC, from the timing runs:

| Edit                 |     Before |      After | Difference |
| -------------------- | ---------: | ---------: | ---------: |
| Shared property row  | 10.842 MiB | 10.785 MiB |    −58 KiB |
| Journal note         | 10.698 MiB | 10.665 MiB |    −34 KiB |
| Trait note           | 10.686 MiB | 10.650 MiB |    −37 KiB |
| Note layout addition | 11.082 MiB | 11.047 MiB |    −36 KiB |

A separate three-pair allocation probe per edit uses CDP heap sampling at a
16 KiB interval, including collected objects. Timing samples do not enable this
profiler. Estimated allocated bytes across the whole save/frame interval:

| Edit                 |    Before |     After |
| -------------------- | --------: | --------: |
| Shared property row  | 2.508 MiB | 2.397 MiB |
| Journal note         | 1.237 MiB | 1.018 MiB |
| Trait note           | 0.864 MiB | 0.706 MiB |
| Note layout addition | 1.286 MiB | 1.049 MiB |

Sampling with three pairs is approximate. These are allocations, not peak live
memory or process RSS. The retained differences are about 0.3–0.5% of the tab's
measured JS heap, and allocation reductions are a few tenths of a MiB per explicit
Save. They do not demonstrate important memory pressure or a GC-stall reduction.

To address actual **process-cold** execution separately, the algorithm probe
starts a new Bun process for every sample: 20 pairs per edit, 160 processes, no
warmup calls. It measures definition propagation plus dependent serialization,
excluding fixture loading, module imports and GC setup. It uses plain JSON rather
than Svelte proxies and excludes browser persistence, rendering and C2; the
browser measurements above cover those application costs.

| Edit                 | Definitions snapshotted, before → after | CPU, before → after |
| -------------------- | --------------------------------------: | ------------------: |
| Shared property row  |                                   8 → 5 |    1.956 → 2.085 ms |
| Journal note         |                                   8 → 1 |    1.599 → 0.964 ms |
| Trait note           |                                   8 → 1 |    1.812 → 0.885 ms |
| Note layout addition |                                   8 → 1 |    1.743 → 1.008 ms |

Reducing snapshots does remove work, but the isolated saving here is under one
millisecond; dependency discovery even costs more for the shared-property case.
This does not establish important CPU consumption at ordinary definition-editing
frequency. A much larger real library could warrant another measurement.

## Correctness and reproduction

Every browser pair asserts identical live document JSON and identical sets of
changed stored definitions. Every matching live instance must receive the class
change. The fresh-process probe also compares complete resulting library hashes.
Unit tests compare the candidate with the baseline for every fixture definition,
including layout additions, unchanged unrelated identity, shared/transitive
dependencies and stale copied references. Existing model tests cover surviving
text/formula/image values.

Raw evidence: [browser samples](browser-raw.json),
[fresh-process samples](cold-process-raw.json). `summary.json` is generated
by `bun scripts/experiments/c1/summarize.mjs` and is not versioned. It retains ranges, paired deltas and bootstrap intervals for all
recorded metrics; the tables deliberately avoid interpreting noisy controls.
The raw metadata names the original generated `examples/smoke-ball/bundle.json`;
`examples/smoke-ball/bundle.mjs` now assembles the identical payload from the
canonical sheet, library, stylesheet and conversion metadata.

To repeat:

1. Regenerate the fixture if needed with `examples/smoke-ball/reproduce.mjs`.
2. Run `bun scripts/experiments/c1/build.mjs`. This requires the baseline save loop,
   builds both snapshots under `/tmp/svc-c1-benchmark`, and restores `+page.svelte`.
3. Serve the before snapshot on 5174 and after snapshot on 5175 with
   `bun scripts/experiments/c1/serve.mjs <snapshot-directory> <port>`.
4. Through the embedded browser MCP, run `benchmarkC1Browser(page, 10, 0)` from
   `scripts/experiments/c1/browser.mjs`; repeat `(page, 3, 10, true)` for allocations.
   Each call restores the previous storage for both benchmark origins.
5. Run `bun scripts/experiments/c1/cold.mjs 20` for the fresh-process probe.
6. Save the raw results using the checked-in JSON structure, then run
   `bun scripts/experiments/c1/summarize.mjs` to regenerate the summary.
7. Stop benchmark servers and remove the temporary snapshots/static fixture.

The candidate adds dependency discovery, transitive closure and batched ownership
bookkeeping to optimize a 63-node library. On the supplied sheet, that complexity
is not justified by either requested benefit criterion.
