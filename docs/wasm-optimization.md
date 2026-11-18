# WASM optimization handoff: dice-wasm and ReactiveBlockBuilder

> Status: architectural analysis and proposal only; no implementation or benchmark has been performed.
>
> Inspected on 2026-11-18:
> - [dice-wasm](https://github.com/0biWanKenobi/dice-wasm), `main` (crate version 0.2.0).
> - [ReactiveBlockBuilder](https://github.com/0biWanKenobi/ReactiveBlockBuilder), `dev`.
>
> Scope: reduce redundant computation, allocation and JS/WASM interop for reactive
> formulas without changing dice semantics or weakening Svelte 5 reactivity.

## Executive summary

The concern that "passing one string at a time" defeats WASM performance is
valid in principle but **does not precisely describe the current design**.
Formulas are compiled once and cached; `FormulaContext` retains compiled ASTs
inside WASM. Ordinary resolution crosses the boundary with a *field ID*, not
with the entire source expression and all of its dependencies.

The larger likely opportunity is that each displayed formula independently
synchronizes its reachable dependency graph and asks Rust to traverse,
reduce, evaluate, format and serialize that graph. Repeated resolution across
many fields with shared dependencies can redo the same work many times.

**Preferred direction:** an incremental, per-sheet graph evaluator owned by
WASM, with batched source changes and changed-result delivery to a fine-grained
Svelte store. Do **not** begin by implementing a custom binary protocol;
first measure where time and allocations actually go.

## Current implementation (verified)

Key entry points:

- [`src/lib/formula/engine.ts`](../src/lib/formula/engine.ts)
  in ReactiveBlockBuilder.
- [`src/lib/blocks/FormulaBlock.svelte`](../src/lib/blocks/FormulaBlock.svelte).
- [`src/lib/editor/nodes.ts`](../src/lib/editor/nodes.ts)
  (Svelte-backed Tiptap formula node views).
- [`dice-wasm/src/lib.rs`](https://github.com/0biWanKenobi/dice-wasm/blob/main/src/lib.rs).
- [`dice-wasm/README.md`](https://github.com/0biWanKenobi/dice-wasm/blob/main/README.md).

### What already works well

1. `CompiledFormula::new(source)` parses via Chumsky, stores an `Rc<Expr>`
   AST, and captures direct dependencies.
2. React's alternative is not used here: ReactiveBlockBuilder keeps a
   `Map<string, CachedFormula>` so identical source strings compile once.
3. `FormulaContext::set(id, compiled)` clones the lightweight wrapper and
   retains shared references to the Rust AST; it does not reparse dependents.
4. A `WeakMap<Sheet, SheetContext>` holds a persistent WASM context per sheet.
   `synchronize(sheet, id)` calls `set` only when a reachable source changed.
5. `FormulaBlock.svelte` uses `$derived` to reevaluate when Svelte-tracked
   source properties change, and rolls only on explicit interaction.
6. Within one Rust `Reduction`, repeated deterministic dependency
   references are memoized; this cache does not persist between resolves.

### Current resolution path

```text
FormulaBlock.$derived
  -> JS resolve(sheet, id)
     -> synchronize(sheet, id)
        -> visit every reachable source in JS
        -> compile/cached lookup for each source
        -> WASM set(id, compiled) only for changed sources
     -> WASM FormulaContext.resolve(id)
        -> dependencies_for(id): DFS, missing fields/cycles
        -> Reduction::field(id): recursively reduce + fold
        -> run(...): evaluate deterministic result (if applicable)
        -> format_expression(...): build output string
        -> serde_wasm_bindgen::to_value(Resolution)
     -> JS object for Svelte rendering
```

In particular, `FormulaContext::describe` unconditionally returns
`{ expression, value, rollable, dependencies }`, including information the
formula block may not use. The displayed expression is only needed for a
rollable preview; the formula block does not consume the returned dependency
array.

### Potential costs to investigate

| Source | Observation | Relative priority |
| --- | --- | --- |
| Repeated graph walks | JS `synchronize` visits reachable nodes, then Rust `dependencies_for` also traverses; every displayed formula resolves separately | High, conditional on workload |
| Repeated reduction/evaluation | Rust reduction cache is per call, not shared across multiple field resolves; shared dependency diamonds can be revisited | High, conditional on workload |
| Result creation | `format_expression` and `serde_wasm_bindgen` materialize strings, arrays and a JS object on every resolve | Medium |
| String marshalling | `resolve(id)`, `set(id, ...)`, `remove(id)` pass short IDs; source strings cross on compile | Likely secondary |
| Compile cache | At 512 distinct sources the entire cache is freed and cleared, causing a later recompile wave | Low/medium |
| Roll RNG | The `d` operator calls `js_sys::Math::random()` once per die from Rust | Low for ordinary RPG pools; benchmark large pools |

These are **code observations and hypotheses, not measured bottleneck rankings**.
The Rust WASM call itself is not equivalent to a network/IPC round trip.
Marshalling, allocations, duplicate work and downstream UI updates may
dominate.

## Recommended target architecture

Keep the WASM library framework-agnostic, but give a Rust-owned
`SheetEngine` (proposed name) responsibility for the dependency graph,
invalidation, cached deterministic values and batched output.

```text
Field source edits / JSON imports (JS)
            |
            v
Svelte adapter collects changed fields
            |
            v
WASM applyChanges(changes) / set/remove
            |
            v
Rust graph: update edges + invalidate affected transitive dependents
            |
            v
WASM flush(): evaluate dirty outputs once, return changed results
            |
            v
Svelte $state resultsById[id] (fine-grained reads)
            |
            v
FormulaBlock renders its own field's result

Explicit roll button -> WASM roll(id) -> dice result
```

Illustrative API (**not existing code**):

```ts
const engine = new SheetEngine(initialFields);

// Only source mutations cross this boundary:
engine.set('STR', '18');

// Evaluate dirty affected fields; this should not roll dice.
const updates = engine.flush();
// e.g. [
//   { id: 'STR', value: 18, rollable: false },
//   { id: 'STR_MOD', value: 4, rollable: false },
//   { id: 'ATTACK', value: null, rollable: true,
//     expression: '1d20 + 4' }
// ]

// Explicit user action; preserve existing per-die roll log.
const outcome = engine.roll('ATTACK');
```

The schema should represent errors as *per-field outcomes*, rather than
letting one invalid formula fail a whole flush. The above sketch omits those
fields solely for readability. Only return changed values/presentations (or
dirty outputs if cheaper); distinguish missing/invalid from a valid null
preview.

### Internal graph and invalidation

- Intern field IDs to integer indices inside Rust. Retain source IDs in the
  public API initially; switch public calls to numeric handles only if
  measurements justify it.
- Track direct dependencies and reverse-dependency edges. On formula change,
  remove stale edges, compile/update the AST, add new edges and mark its
  transitive reverse dependents dirty.
- Evaluate dirty nodes in dependency order; cache deterministic outcomes and
  reusable reduced subexpressions across output requests. Make cache
  invalidation explicit, especially when an affected dependency changes.
- Do not cache *roll results*. Each occurrence of a referenced dice expression
  must still represent a fresh evaluation when rolled, as it does now.
- Preserve cycle detection, bounded graph traversal, resource limits and
  meaningful per-field errors.
- Preserve conditionals and lazy-branch semantics. Static dependency edges can
  be a conservative superset of the references actually evaluated; avoid
  accidentally changing which branch errors surface or when dice are rolled.
- Cache formatted rollable previews separately if useful. Only invalidate
  their formatting when affected deterministic values change.
- Decide whether consumers register visible output fields, so `flush` need
  not format every intermediate field merely to support a small visible set.

### Svelte integration and lifecycle

- Prefer a per-sheet adapter (Svelte-specific) over Svelte primitives inside
  the Rust library. Keep a fine-grained `$state` result object or equivalent
  so a formula block can subscribe to `resultsById[attrs.field]` rather than
  independently calling `resolve(sheet, attrs.field)`.
- Make field edits explicit (e.g. a `setFormula`/batch edit pathway), or
  provide an equally reliable reactive bridge. The current
  `synchronize` intentionally reads each reachable `sheet[name].formula`
  inside `$derived` so Svelte tracks edits. Removing it without replacing
  that tracking would silently break reactivity.
- Ensure all write paths use the same bridge: field editor, renaming/deletion,
  imported JSON, initial load, and programmatic edits. Existing JSON import
  mutates the *same* reactive `fields` object to preserve node-view references.
- Handle multiple formula blocks displaying one field without duplicate
  evaluation. Handle a block changing its `attrs.field` subscription.
- Batch multiple writes from JSON import or a single user action; avoid
  scheduling one WASM flush for every assigned property.
- On sheet teardown, release WASM handles and subscriptions; keep the
  existing `releaseSheet` semantics. Avoid keeping unbounded compiled ASTs
  alive after sheets are released.
- Do not make a roll a reactive dependency. Rolling is an explicit action
  and must not cause deterministic fields to reroll as a side effect.

## Incremental implementation plan

### Phase 0 — establish a baseline (before redesign)

Instrument the existing boundary without changing results. For each
representative operation collect call count, elapsed time and where practical
allocations:

- Compilation (cold/new formula vs cached formula).
- JS synchronization and its source reads.
- Rust `dependencies_for`, reduction, evaluation, formatting,
  and JS-result serialization.
- Total `resolve` time, total update-to-render time, and Svelte rendering.
- Roll latency and rolls per operation.

Use the production/Vite build, warmed WASM module and fixed test fixtures.
Separate startup and compilation from steady-state work; measure browser
main-thread and memory impacts. Repeat trials and report distributions
(median, p95), not one-off numbers.

Suggested workloads:
1. Small sheet: tens of fields with shallow references.
2. 50 / 200 / 1,000 dependent formula outputs sharing one editable stat.
3. Deep chains and wide dependency diamonds.
4. Changes to an unrelated field (expect minimal/no visible work).
5. Repeated changes to one source vs wholesale JSON import.
6. Multiple blocks referencing the *same* field.
7. Rollable branches, conditionals, invalid references and cycles.
8. Large dice pools separately from realistic D&D-style rolls.

Track correctness and number of `resolve`, `set`, and `roll` crossings.
Do not assume a batched API is faster until end-to-end results show it.

### Phase 1 — low-risk changes

1. Add a compact preview resolution path that can omit unused dependencies
   and, for deterministic results, avoid formatting an expression string.
   Prefer not to construct the unused data in Rust at all.
2. Replace the all-or-nothing 512-entry compiled-formula cache eviction with
   bounded LRU or a measured alternative. Ensure WASM wrappers are freed
   safely; a context's owned AST references must remain valid.
3. Consider deduplicating simultaneous per-field resolutions where multiple
   blocks display one ID, while preserving Svelte's dependency tracking.
4. Rerun the baseline suite. Stop here if it meets the latency/memory budget.

### Phase 2 — graph-oriented WASM core (if benchmarks justify it)

1. Introduce a persistent Rust graph with reverse edges and dirty tracking.
2. Add explicit update/batch APIs and a `flush` that returns per-field
   results/errors.
3. Add per-sheet Svelte adapter and migrate formula blocks away from calling
   `resolve` separately; preserve imported-sheet behavior.
4. Invalidate deterministic caches precisely; handle cycles, missing fields,
   conditional branches, deletion and renaming.
5. Run semantic regression tests and performance comparisons against Phase 0.

This is an architecture change spanning **both repositories**: core engine API
in dice-wasm, consumption/reactivity in ReactiveBlockBuilder. Publish a new
dice-wasm release asset and update the consuming package reference only after
the new API has been validated.

### Phase 3 — only if profiling proves necessary

- Replace public string identifiers with numeric field handles.
- Return packed primitive results via typed arrays or shared WASM linear
  memory, keeping richer JS objects only for errors and roll details.
- Consider a dedicated Rust PRNG seeded securely from browser entropy so
  large dice pools avoid one Rust-to-JS `Math.random()` call per die. Ensure
  unbiased outcomes and preserve observable roll semantics.
- Reconsider data structures (`BTreeMap<String, ...>`, `Rc<Expr>`) only with
  profiling evidence; changing them prematurely increases complexity.

## Correctness criteria / non-negotiable semantics

Before declaring an optimization successful, confirm:

- Formula syntax, boolean results, arithmetic and keep/drop semantics are
  unchanged, including numeric-vs-boolean roll-result restrictions.
- Dependencies and field identity remain correct after edits, imports,
  deletions and references to missing fields.
- Deterministic formulas update automatically; dice **never** roll during
  a normal reactive recomputation.
- Each explicit roll produces its own dice log, with correctly marked kept
  and dropped dice.
- Repeated references to dice expressions remain independent roll
  evaluations, not cached values.
- Lazy conditional behavior and cycle/error handling remain compatible with
  the current engine.
- Existing limits are retained: per-source 1,024 UTF-8 bytes and 500 AST
  nodes; graph/evaluation recursion and step limits; formatted output limit.
- Svelte recomputes only relevant visible blocks, and all temporary WASM
  resources are released when no longer needed.
- Existing tests pass; add regression tests for graph invalidation and
  cross-sheet isolation. No changes to these semantics are implied by
  this document.

## Decision

**Do not prioritize replacing every short string parameter with a binary
protocol.** The current design already avoids reparsing formula source on
ordinary evaluations. Optimize redundant graph work, unnecessary result
serialization and reactive fan-out first, guided by measurements.

If typical sheets are already fast, the compact preview API and a proper
cache-eviction policy may be sufficient. A persistent incremental WASM graph
is the preferred *scaling* direction, not a requirement justified by
benchmarks yet.
