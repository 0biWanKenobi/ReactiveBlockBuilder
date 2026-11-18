# Compact WASM API experiment: results

> Experimental branches only. This report is populated from GitHub Actions
> evidence; do not interpret a missing timing sample as a performance win.
>
> - Rust: [dice-wasm exp/compact-api](https://github.com/0biWanKenobi/dice-wasm/tree/exp/compact-api), version 0.2.1.
> - App: [ReactiveBlockBuilder exp/compact-api](https://github.com/0biWanKenobi/ReactiveBlockBuilder/tree/exp/compact-api).
> - Rust CI: [build and tests](https://github.com/0biWanKenobi/dice-wasm/actions/runs/44402730955).
> - Successful Chromium run: [GitHub Actions #44403396258](https://github.com/0biWanKenobi/ReactiveBlockBuilder/actions/runs/44403396258) (raw samples: `wasm-compact-browser-results` artifact).

## Comparison

Both APIs run in **the same 0.2.1 WASM binary**, using the same persistent
`FormulaContext` and the same JavaScript `synchronize(sheet, id)` routine.
Only the representation of the resolved preview differs:

- **Full**: `resolve()` returns `expression`, `value`, `rollable` and
  the transitive `dependencies` array.
- **Compact**: `resolve_compact()` returns `value`, `rollable`, and an
  `expression` string *only for rollable formulas*. It does not calculate
  a separate dependencies array for the *output*; dependency traversal for
  cycle/missing-reference validation is **still performed**.
- The existing compiled-formula dependency API and full resolve API are
  preserved for future navigable formula-detail views.

The compact change **does not** remove graph traversal, reduction or numeric
evaluation; improvements are expected principally from avoided formatting
and result serialization. It is not a test of a persistent incremental
dependency graph or batched cross-boundary updates.

## Real-world fixture

Use [the checked-in Smoke Ball sheet](../../examples/smoke-ball/sheet.json),
derived from the Android character-sheet export. It has **238 formula
fields** (202 original properties plus 36 roll-related fields). Browser test
selects distinct visible formula IDs by traversing the saved document, and
also runs a workload covering all 238 fields.

The browser test auto-selects a numeric source field with the largest
transitive set of dependents, edits that source repeatedly, and evaluates
either all fields or the visible set. Both methods use distinct, identically
initialized sheets; warmups are excluded from timings. Order alternates in
20 paired runs.

The Chromium test checks result parity on every fixture field before
timing, comparing numeric/boolean preview values, rollability, formatted
rollable expressions and errors. The full API's additional deterministic
`expression` and `dependencies` are intentionally excluded from
**preview** parity because they are outside the compact response contract;
dependency inspection remains accessible through the full API.

## Results

### Rust tests and package

- **PASS:** dice-wasm experimental 0.2.1 build and tests via the workflow
  linked above; the 0.2.1 GitHub Actions tarball artifact was produced.
- New Rust tests cover deterministic, boolean, dice and lazy-conditional
  previews, plus cycle, missing-reference and evaluation-error parity.

### Chromium timings

Recorded by `scripts/experiments/wasm-compact/browser.mjs` and uploaded
as the `wasm-compact-browser-results` artifact. Each timing is the elapsed
JavaScript loop wall time in Chromium and includes synchronization,
WASM invocation and JS result conversion; it **does not** isolate WASM
execution, JS heap allocations or application paint latency.

| Workload | Full median (ms) | Compact median (ms) | Full/compact speedup |
| --- | ---: | ---: | ---: |
| All 238 fields, warm | 1.20 | 0.80 | 1.50× |
| 109 distinct visible formula fields, warm | 0.40 | 0.30 | 1.33× |
| Source edit (`F1_LEVEL`), visible fields | 0.40 | 0.30 | 1.33× |
| Source edit (`F1_LEVEL`), all 238 fields | 0.80 | 0.60 | 1.33× |

**Outcome:** **PASS** in [run #44403396258](https://github.com/0biWanKenobi/ReactiveBlockBuilder/actions/runs/44403396258).
The parity check covered all 238 fields; 109 distinct fields occur visibly in the
saved document. `F1_LEVEL` was selected automatically as the numeric source
with the widest transitive impact (**65 fields**). There were **20 measured
iterations per workload**, preceded by three unmeasured warmups. The benchmark
ran on a GitHub-hosted Linux runner with HeadlessChrome
**156.0.8078.4**.

Paired median improvements (full time minus compact time):

| Workload | Paired median saved (ms) |
| --- | ---: |
| All fields | 0.35 |
| Visible fields | 0.10 |
| Source edit, visible | 0.15 |
| Source edit, all | 0.20 |

**Measurement cautions:** values are quantized to roughly 0.1 ms in these
recordings, so the relative speedups can sound more substantial than the
absolute improvement. In the first all-fields scenario, timings drifted
downward as execution continued (the final ten samples' medians were about
0.90 ms full versus 0.60 ms compact), indicating that the three warmup
iterations did **not** fully stabilize this case. The 20 paired samples are
useful directional evidence, not a rigorous confidence interval. These
measurements include JS synchronization and WASM result conversion but exclude
actual Svelte/Tiptap rendering, interaction-to-paint latency, and allocation
profiling. No claim of a user-perceptible speedup is warranted from this run.

## Reproduction

On the app experimental branch:

1. Build dice-wasm `exp/compact-api` with `wasm-pack` and package it as
   version 0.2.1, then install that tarball in the benchmark workspace.
2. `bun run check` and `bun run build`.
3. Serve the app at `http://127.0.0.1:5189`.
4. Run `node scripts/experiments/wasm-compact/browser.mjs`; it opens
   `/wasm-bench`, enforces semantic parity and writes
   `wasm-compact-results.json` with every timing sample.
5. The experimental formula UI can also be compared manually: default
   query string uses full previews, while `?compact` uses compact previews.

GitHub Actions automates the steps in `.github/workflows/wasm-compact.yml`.
Results are specific to the CI runner/browser and should be repeated on a
representative user device before making product-level claims.

## Interpretation and next decision

The immediate question is whether dropping unused preview metadata is a
meaningful improvement on the real 238-field workload, not whether WASM
is inherently faster than JavaScript.

The compact path was consistently faster in this one run, saving about
**0.1–0.4 ms per batch** on the smoke-ball fixture. This is a modest
absolute gain, not evidence that a more complex batching or graph rewrite is
needed at this scale. Keeping a low-cost compact rendering path is reasonable,
provided that the full dependency API remains available for on-demand,
navigable formula inspection. For a production decision, repeat on a user
machine with an end-to-end edit-to-paint measurement and consider larger
dependency graphs before investing in the persistent incremental design.

The larger proposal in [wasm-optimization.md](./wasm-optimization.md)
(incremental graph invalidation and batched changed-value propagation)
remains **unimplemented** and is not covered by these measurements.
