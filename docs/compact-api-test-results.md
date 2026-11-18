# Compact WASM API experiment: results

> Experimental branches only. This report is populated from GitHub Actions
> evidence; do not interpret a missing timing sample as a performance win.
>
> - Rust: [dice-wasm exp/compact-api](https://github.com/0biWanKenobi/dice-wasm/tree/exp/compact-api), version 0.2.1.
> - App: [ReactiveBlockBuilder exp/compact-api](https://github.com/0biWanKenobi/ReactiveBlockBuilder/tree/exp/compact-api).
> - Rust CI: [build and tests](https://github.com/0biWanKenobi/dice-wasm/actions/runs/44402730955).
> - Chromium benchmark: [GitHub Actions](https://github.com/0biWanKenobi/ReactiveBlockBuilder/actions/workflows/wasm-compact.yml).

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
| All 238 fields, warm | Pending | Pending | Pending |
| Distinct visible formula fields, warm | Pending | Pending | Pending |
| One source edit, visible fields | Pending | Pending | Pending |
| One source edit, all fields | Pending | Pending | Pending |

**Status:** the browser run is in progress. Do not claim a measured speedup
until its logs and raw timing samples have been inspected. If the run fails,
record the error and mark the comparison as inconclusive rather than inventing
metrics.

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

If the difference is small relative to normal browser timing noise,
retain the full dependency API and avoid added architectural complexity.
If the difference is repeatable and consequential, a separate compact
rendering path can coexist with on-demand, navigable dependency inspection.

The larger proposal in [wasm-optimization.md](../wasm-optimization.md)
(incremental graph invalidation and batched changed-value propagation)
remains **unimplemented** and is not covered by these measurements.
