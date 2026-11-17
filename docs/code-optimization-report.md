# Code optimization deep dive

Findings refreshed **2026-11-17** against **`eb6371f`**. The older reconciliation/protection microbenchmarks were run **2026-11-15** against **`485fe81`**; those functions are unchanged. C1's metadata/CSS save gate and CSS cache update are implemented. A production-browser and fresh-process comparison on the reproduced Smoke Ball sheet now supports deferring the remaining C1 work; the candidate is retained only as an experiment. Only existing findings were checked; no new optimization search.

Scope: production source, tests, and tooling outside `src/lib/formula/engine.ts`. That file was not inspected and has no recommendations here. Current design uses expanded custom instances. The older compact-node experiment report describes another implementation; its results are not treated as current evidence. No glossary or ADR files were present.

The remaining opportunities reduce repeated work around the editor: reconciling unrelated definitions when saving and successive tree copies at ownership boundaries. Several smaller extractions improve consistency; they should not be sold as runtime wins. Original finding IDs are retained.

## Priority and scope

Impact describes the expected benefit, not a measured improvement from an implemented change. **Small** effort means a bounded local change; **medium** crosses a few callers; **large** changes synchronization or transaction bookkeeping. Performance findings distinguish confirmed repeated work from unmeasured browser benefit.

| Priority      | ID  | Opportunity                                           | Main benefit                              | Effort / risk             |
| ------------- | --- | ----------------------------------------------------- | ----------------------------------------- | ------------------------- |
| Profile first | C1  | Limit structural definition-save propagation          | Save cost scales with affected data       | Medium–large / medium     |
| First         | C2  | Reconcile only affected live custom instances         | Less serialization and rebuilding on save | Medium / medium           |
| Next          | C3  | Remove successive tree copies at ownership boundaries | Fewer allocations in creation/drag flows  | Medium / medium           |
| Next          | C4  | Share block-kind and leaf-value metadata              | Remove duplicated policy                  | Medium / low–medium       |
| Next          | U6  | Share inspector contract and common fields            | Remove form/type duplication              | Small–medium / low–medium |
| Small cleanup | U7  | Remove export's second field clone                    | Simpler explicit export                   | Small / low               |
| Small cleanup | U8  | Remove unused Button and HtmlTag                      | Smaller maintenance surface               | Small / low               |
| Optional      | C5  | Share atom NodeView lifecycle                         | Remove bounded lifecycle duplication      | Small–medium / medium     |
| Profile first | U5  | Split independent stylesheet updates                  | Less unrelated CSS replacement            | Medium / medium           |
| Profile first | C6  | Reuse drag geometry within a calculation              | Less layout-query work                    | Small–medium / medium     |
| Profile first | C7  | Reduce protection's whole-document discovery scans    | Large-document transaction scaling        | Large / high              |
| Profile first | C8  | Index definitions by type ID                          | Large-library lookup scaling              | Small–medium / medium     |

C1 and C2 overlap: narrowing propagation first reduces the amount of work available for C2 to save. Measure their combined path rather than adding hypothetical gains.

## Baseline and measured evidence

The measurements cover two application paths still relevant to the remaining findings: refreshing custom-block instances (C1/C2) and checking edits against custom-block protection rules (C7). Both were rerun on **2026-11-15**. Each script ran in three fresh Bun processes, sequentially, with no concurrent tests or builds. Tables report the median of the three per-process medians and their observed ranges. These measure the current implementation, not savings from a proposed fix.

### Existing tests and type checks

Unit tests and type checks rerun against the current working tree on **2026-11-17** (Bun 1.4.4):

- `bun test`: **36 passed, 0 failed; 261 assertions across six files**.
- `bun run check`: **0 errors, 0 warnings**.
- `bunx vite build` and `bun run prepack`: **passed**.

These checks establish that the reviewed code passes its existing automated checks. The focused embedded-browser regression in `scripts/test-definition-save.mjs` also passes for C1's implemented gate/cache update; remaining proposals are unimplemented. Targeted ESLint still reports two pre-existing issues in `+page.svelte`: an unused Svelte suppression and `null as any` in cleanup.

### 1. Refreshing custom-block instances — supports C1 and C2

**Application path.** When a custom-block definition changes, its existing instances need the new layout/classes while keeping their entered text, formula-field references, formula labels/visibility, and image values. `prepareDocument` performs that reconciliation. Definition saving invokes it across stored definitions, and live-editor synchronization invokes it across sheet instances. Sheet import also uses it. The first row below, containing only stock blocks, is a traversal/copying control workload.

**Proposed change.** C1 narrows save propagation to affected definitions; C2 narrows live synchronization to affected instances. Both aim to avoid preparing unrelated trees. This table measures the cost of one existing preparation pass; it does not measure the full Save action or the savings from either proposal.

**Measurement.** `bun scripts/benchmark-prepare-document.mjs` uses plain JSON definitions, with three warmups followed by 15 samples per workload per process. Each sample times one complete `prepareDocument` call. Fixture construction is outside the timed region; node counts include text nodes. Source: [scripts/benchmark-prepare-document.mjs:62](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/benchmark-prepare-document.mjs:62), measurement loop at [scripts/benchmark-prepare-document.mjs:80](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/benchmark-prepare-document.mjs:80).

| Reconciliation workload                       | JSON nodes | Median of medians | Process-median range |
| --------------------------------------------- | ---------: | ----------------: | -------------------: |
| Stock tree, depth 12, 40 roots                |      6,361 |           0.61 ms |         0.54–0.76 ms |
| 100 instances, 60 leaves each                 |      8,101 |           1.33 ms |         1.30–1.39 ms |
| 60 parent instances, six nested children each |     12,901 |           2.79 ms |         2.73–3.28 ms |

**Interpretation.** A single pass is inexpensive in these fixtures: median times of 0.61–2.79 ms for 6,361–12,901 nodes on this machine. That supports first reducing how often preparation runs and how much unrelated data it receives. It does not establish that reconciliation is the main source of save latency; the complete save path also snapshots, compares, persists, and updates editor state.

### 2. Checking edits against custom-block protection — supports deferring C7

**Application path.** Ordinary document edits pass through `CustomNodeProtection`, which allows value edits while rejecting changes to a custom instance's protected structure/classes. It discovers outer custom instances in the old and new documents on each ordinary document change. The workloads below type one character either in a stock-only sheet or in a stock text block preceding unchanged custom instances.

**Proposed change.** C7 would retain these protection rules while using an incremental index/changed ranges to reduce repeated instance-discovery scans. This is a larger, higher-risk refactoring. The probe tests whether that overhead is large enough to prioritize the work; browser profiling would still be needed.

**Measurement.** `bun scripts/benchmark-custom-node-protection.mjs` compares identical `EditorState.applyTransaction(state.tr.insertText('!', 2))` calls with the protection plugin enabled and disabled. Disabling it is an experimental control to isolate its cost; removing protection is not the proposed change. Both states share the same immutable document; each sample starts from its original state. Each process uses 20 warmups and 101 samples per control, alternating control order. Fixture construction and assertions are outside the timed region. Assertions check accepted/equivalent edits and unchanged input. Source: [scripts/benchmark-custom-node-protection.mjs:29](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/benchmark-custom-node-protection.mjs:29).

| Edit workload                                                      | Without protection | With protection | With-protection process-median range |
| ------------------------------------------------------------------ | -----------------: | --------------: | -----------------------------------: |
| 100 stock text blocks                                              |          0.0102 ms |       0.0247 ms |                     0.0236–0.0277 ms |
| 1,000 stock text blocks                                            |          0.0054 ms |       0.0669 ms |                     0.0665–0.0718 ms |
| 5,000 stock text blocks                                            |          0.0178 ms |       0.3332 ms |                     0.3153–0.3365 ms |
| Stock edit before 100 unchanged custom instances, 60 leaves each   |          0.0024 ms |       0.0354 ms |                     0.0332–0.0462 ms |
| Stock edit before 1,000 unchanged custom instances, 60 leaves each |          0.0047 ms |       0.2259 ms |                     0.2210–0.2472 ms |

**Interpretation.** Discovery overhead grows with sheet size, but even the 5,000-stock-block case takes about 0.333 ms with protection here (0.315–0.337 ms across process medians). Its small absolute cost supports deferring C7 until browser profiling shows a problem. The comparison does not predict the performance of an incremental index.

### Limits of these measurements

These are single-machine **Bun 1.4.4 / Linux x64 CPU microbenchmarks**, on an **AMD Ryzen 3 3200G with Radeon Vega Graphics** (four logical CPUs). No DOM updates, Svelte scheduling, CodeMirror replacement, layout, paint, or reactive library proxies are included. Sub-millisecond results are sensitive to runtime noise. The tables measure different operations and workloads, so their times should not be added together or treated as components of one measured user action. They support keeping C7 behind the bounded repeated-work changes; they supply no before/after speedup claim. Full browser behavior suites were not run; the focused C1 production-browser comparison below was run.

## Detailed UI findings

### U5. Isolate stylesheet updates instead of replacing all theme and block CSS

**Evidence.** `ThemeStyleStore.appliedCSS` derives one combined theme string ([src/lib/themes/store.ts:60](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/themes/store.ts:60)), and a single effect in `mainPane.svelte` appends all custom-block styles into one `styleElement.textContent` ([src/routes/components/mainPane/mainPane.svelte:58](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/mainPane/mainPane.svelte:58)). Every theme keystroke therefore rebuilds a text string containing unrelated sections and custom-block CSS. The intended order is explicit: container, text, formula, image, then Shared ([src/lib/themes/styles.ts:80](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/themes/styles.ts:80)), followed by custom-block styles in the main pane. Moving store ownership out of the theme editor keeps styles active across drawer switches, but does not isolate text replacement by section.

**Optimization.** First isolate the custom-block stylesheet into a persistent sibling style element so theme edits do not repeatedly replace that unchanged text. If profiling supports it, give each editable stock/Shared section a stable style element in the existing cascade order and update only changed sections. Preserve ordering when definitions are added/deleted. Keep invalid or deliberately empty CSS as user input; do not turn this into an implicit normalization pass.

**Expected impact, hypothesis.** Less concatenation and replacement of unrelated CSS as stylesheet/library size grows. Reduced CSS parsing work is plausible, but actual browser parsing/style-recalculation savings require a performance trace; separating elements does not guarantee less selector matching or layout.

**Effort/risk.** Medium. Cascade order, global `@layer` usage, and arbitrary user-supplied at-rules require comparison against current single-stylesheet behavior. Keep as a profile-first candidate if current CSS payloads are small.

**Meaningful verification.** Reuse [scripts/test-stock-themes.mjs:52](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-stock-themes.mjs:52) for full replacement and retained sibling drafts, [scripts/test-stock-themes.mjs:100](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-stock-themes.mjs:100) for empty CSS, and [scripts/test-expanded-nodes.mjs:212](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-expanded-nodes.mjs:212) for modal isolation. Add competing selectors across stock, Shared, and custom CSS, plus supported at-rules. Compare style-element text mutations and browser performance traces while typing into one small section with many large unrelated block styles.

### U6. Consolidate the selected-block contract and common inspector fields

**Evidence.** The helper already owns a `SelectedEditorBlock` contract ([src/lib/editor/selection.ts:4](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/selection.ts:4)), but the modal inspector declares an identical local structure ([src/lib/custom-blocks/modal-editor/Inspector.svelte:6](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/modal-editor/Inspector.svelte:6)). Main inspector duplicates the fields while narrowing `type` to registered `SheetNodeType` ([src/routes/components/rightSidebar.svelte:25](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/rightSidebar.svelte:25)). Both surfaces render class, formula-field, formula-label/visibility, and image-source inputs and perform selection-preserving updates through `updateBlockAttribute` ([src/routes/components/rightSidebar.svelte:61](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/rightSidebar.svelte:61), [src/lib/custom-blocks/modal-editor/Inspector.svelte:23](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/modal-editor/Inspector.svelte:23)). Both also enforce the same class-edit restriction on custom roots/descendants.

**Optimization.** Reuse the existing selection type directly in the modal and derive the main inspector's narrowed type from it. Consider a small shared block-field fragment/component accepting selected attrs and an attribute-change callback, keeping actions and surrounding layout in each owner. Existing extraction has already centralized position resolution and attribute transactions; extend that seam rather than building a generic inspector framework.

**Expected impact, hypothesis.** Less contract and form duplication; future field changes become easier to keep consistent. No meaningful runtime gain claimed.

**Effort/risk.** Low for type reuse, medium for shared fields. The surfaces intentionally differ: main has formula-value editing, field-ID validation, image alt text, style navigation, play-mode handling, and icon deletion; modal has nested-definition navigation, preview syncing, and different labels/layout ([src/routes/components/rightSidebar.svelte:131](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/rightSidebar.svelte:131), [src/lib/custom-blocks/modal-editor/Inspector.svelte:33](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/modal-editor/Inspector.svelte:33)). Preserve those differences explicitly. Adding alt editing to the modal is a separate behavior choice, not required for this cleanup.

**Meaningful verification.** Existing [scripts/selection.test.ts:50](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/selection.test.ts:50) covers focus-safe selection-preserving transaction semantics. Browser checks should cover both inspectors, hidden class controls for custom descendants, nested navigation, image alt editing on the main surface, and modal JSON synchronization. Avoid tests that merely mirror a new component's markup.

### U7. Remove the second complete field clone during sheet export

**Evidence.** Export immediately serializes a temporary `SavedSheet`, yet its fields are first copied with `structuredClone($state.snapshot(fields))` ([src/routes/components/mainPane/sourcePanels.svelte:63](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/mainPane/sourcePanels.svelte:63)). The temporary object never escapes; line 70 immediately passes it to `JSON.stringify`. The installed Svelte snapshot implementation recursively copies plain objects/arrays ([node_modules/svelte/src/internal/shared/clone.js:57](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/node_modules/svelte/src/internal/shared/clone.js:57)). Current field creation/import constructs plain `{ id, formula }` records ([src/routes/components/leftSidebar.svelte:54](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/leftSidebar.svelte:54), [src/routes/components/mainPane/sourcePanels.svelte:117](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/mainPane/sourcePanels.svelte:117)).

**Optimization.** Serialize `$state.snapshot(fields)` directly; remove the outer `structuredClone`. Keep the snapshot boundary as the explicit plain-data projection. No deferred work or mutation requires a second detached copy here.

**Expected impact, hypothesis.** Removes one complete field-object clone and its allocation per explicit export. Low absolute impact for the sample field set; larger sheets benefit more. This is primarily straightforward simplification.

**Effort/risk.** Low. Check exported JSON equality and absence of field mutations. Do not replace the reactive `fields` object during import: the code explicitly preserves its identity because existing formula views reference it ([src/routes/components/mainPane/sourcePanels.svelte:115](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/mainPane/sourcePanels.svelte:115)).

**Meaningful verification.** Existing expanded-document round trip at [scripts/test-expanded-nodes.mjs:464](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-expanded-nodes.mjs:464), plus rejected-import field atomicity at [scripts/test-custom-blocks.mjs:140](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-custom-blocks.mjs:140). Compare full exported fields before/after and verify later field edits do not alter the already exported JSON string.

### U8. Remove the unused polymorphic Button component and its private type

**Evidence.** [src/lib/components/Button.svelte:1](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/components/Button.svelte:1) implements a generic dynamic-tag button, custom key handling, and bound element ownership. A reference search across all `src` and `scripts`, excluding the forbidden formula engine, found no consumers: no imports or uses of `Button.svelte` were found. Other names such as `DialogButton` are unrelated. `HtmlTag` appears only in that component and its declaration at [src/lib/types/shared.ts:5](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/types/shared.ts:5). Neither component nor type is exported by [src/lib/index.ts:1](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/index.ts:1). Current UI uses native buttons and specialized Switch/Dropdown controls.

**Optimization.** Delete the unused Button component and `HtmlTag`; remove the now-unused `SvelteHTMLElements` type import from shared types. Keep the other shared types: the sidebar uses `OpResult`, while editor/tab code uses `Listen` and `Tab`. Do not expand this into converting the many native buttons to a new component merely to justify existing dead abstraction.

**Expected impact.** Removes an unused abstraction and its maintenance surface. No shipped-bundle or runtime improvement claimed: the component is unreferenced.

**Effort/risk.** Low for the current app. Neither item is exported by the public package index. Keep this removal within the current design; no compatibility shim is needed.

**Meaningful verification.** Repeat the reference search at implementation time; run Svelte/type checking and package validation to catch unexpected references. Existing runtime behavior should be unchanged, so a dedicated behavior test would add little value.

## Detailed model and editor findings

### C1. Make definition saves proportional to the change

**Implemented.** The modal tracks applied preview changes with a conservative `needsSync` hint and checks root-class changes when saving or navigating. The hint survives nested navigation and remains separate from semantic discard checking and unapplied JSON drafts. Existing name/CSS-only saves now skip stored-definition reconciliation and live synchronization; new definitions always synchronize. Saved CSS updates the cache from the submitted string, rebuilding its order from the final library order without rereading stylesheets. Sources: [src/lib/custom-blocks/CustomBlockEditorModal.svelte:65](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/CustomBlockEditorModal.svelte:65), [src/routes/+page.svelte:181](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/+page.svelte:181).

**Remaining evidence.** Structural/root-class saves still iterate over **every definition**, snapshot it, reconcile its full structure, and stringify both before and after to discover changes. They then synchronize all live custom instances. Source: [src/routes/+page.svelte:192](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/+page.svelte:192).

**Remaining optimization.** For structural/root-class changes, compute the changed type and its transitive dependents. Build direct dependency edges from custom-instance references, stopping at each custom root rather than treating its embedded copied children as independent definition references. Reconcile that affected set against a consistent candidate library. Share definition snapshots across the batch where practical; the current loop starts a new cache for every definition. Persist/upsert only results that differ.

**Decision: defer.** The [Smoke Ball before/after report](benchmarks/c1-smoke-ball/README.md) uses a screenshot-informed eight-definition library, 80 cold browser-document loads and 160 fresh Bun processes. Median Save closing times differ by about 0–3 ms, renderer CPU shows no consistent saving, and retained heap differs by only 34–58 KiB. Only the layout-addition timing has a positive exploratory confidence interval (paired median saving 1.55 ms). Neither a user-perceptible improvement nor important resource savings is demonstrated. The per-save dependency/batch candidate remains in `scripts/experiments/c1/propagation.ts`; production propagation is unchanged. Dependency tracking can follow if a larger real library justifies it. Avoid replacing string comparisons with hashes unless their maintenance and equality semantics are justified.

**Observed work reduction.** In a two-definition browser fixture, name/CSS saves perform zero reconciliation snapshots, while structural saves still snapshot both definitions. All tested saves perform zero block-stylesheet reads. This validates removed work, not a timing improvement. The remaining opportunity removes unrelated snapshots, traversals, and comparisons from structural saves, whose cost still follows aggregate library size. Actual latency improvement remains unmeasured.

**Effort/risk.** Medium–large for dependency propagation. Preserve nested-instance value ownership and class propagation. Do not blindly parallelize dependent saves: compute changes from a stable library view before writing, and retain existing error reporting.

**Verification.** `scripts/test-definition-save.mjs` passes in the embedded browser: metadata/CSS gating, immediate CSS/cascade updates, root-class and applied-JSON propagation, preserved instance text, nested parent persistence, preview edits surviving child save/close, clean navigation, reset, reverted edits, unchanged discard semantics, and new-definition saving. Existing nested propagation scenario: [scripts/test-expanded-nodes.mjs:400](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-expanded-nodes.mjs:400). For dependency tracking, measure save duration and reconciliation/read/write counts across independent definitions, dependency chains, and shared children; assert unrelated definitions are untouched.

### C2. Filter live-instance synchronization by affected type

**Evidence.** `synchronizeCustomNodes` collects every outer custom instance, serializes all of them, reconciles all of them, constructs fresh ProseMirror nodes for all results, and only then uses `node.eq(after)` to avoid unnecessary replacement. The current design already preserves unrelated stock nodes and selection and batches replacements in reverse position order. Source: [src/lib/editor/customNodes.ts:84](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/customNodes.ts:84).

**Optimization.** Accept the affected type set from C1 and filter the collected outer roots before JSON conversion. Include outer types that depend transitively on the edited type, because the traversal intentionally stops at outer custom roots. CSS-only/name-only saves already skip this function entirely. Keep one `prepareDocument` call for the selected batch, the equality check, reverse-order replacements, `customNodeSync`, and `addToHistory: false`.

**Expected impact.** Reduces JSON allocation, reconciliation, `nodeFromJSON`, and equality work when most sheet instances are unrelated. The remaining outer-root discovery scan still follows document size. This is a targeted extension of the existing optimized approach, not a proposal to replace the whole document.

**Effort/risk.** Medium. An incomplete affected set leaves nested instances stale. Whole-instance replacement can still remount changed descendants; optimizing that further would require a more involved tree diff and is not justified by measurements here.

**Verification.** Save a child referenced by multiple outer types and verify every affected occurrence, preserved text/formula/image values, including formula label/visibility, unchanged unrelated node identity, and valid selection mapping. Existing value-evolution/model tests and expanded-node browser scenarios describe the semantics; add a large mostly-unrelated sheet benchmark for the changed synchronization path.

### C3. Give each tree one clear copy owner

**Evidence.** Several call chains create successive detached copies:

- Palette custom drag: `$state.snapshot(block)` → `makeInstance`'s `structuredClone` → caller's `prepareDocument`; modal drag additionally calls `ensureNodeIds`, which clones again. Sources: [src/lib/editor/BlockPalette.svelte:29](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/BlockPalette.svelte:29), [src/lib/custom-blocks/model.ts:38](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/model.ts:38), [src/lib/custom-blocks/CustomBlockEditorModal.svelte:171](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/CustomBlockEditorModal.svelte:171).
- Conversion creation: `startNewDefinition` normalizes/copies editor JSON, then `createDefinition` reconciles and normalizes/copies again. Sources: [src/routes/+page.svelte:108](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/+page.svelte:108), [src/lib/custom-blocks/model.ts:144](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/model.ts:144).

**Optimization.** Keep safe public copying functions, but separate internal operations on already-owned plain trees from boundary snapshotting. For example, snapshot a reactive definition once, assign instance identity on that owned root, and reconcile once; allow ID normalization to visit an already-detached result without another clone. Consolidate the palette's preparation responsibilities so callers do not each invent a different copy sequence.

For conversion, preserve the **first normalized IDs** shared by `pendingOriginal` and the new definition. Removing that step blindly can generate different IDs in each copy and break later value matching. A single conversion-preparation operation returning both related results would make that invariant explicit.

**Expected impact.** Fewer complete allocations/traversals on definition creation and palette drag, primarily for large custom trees. These are explicit actions rather than each-keystroke paths, so prioritize below the per-edit and definition-save paths.

**Effort/risk.** Medium. Reactive proxies must still become plain data before operations requiring cloneable input. Never share mutable result nodes/attrs with definitions or sibling instances; current isolation test explicitly requires detached outputs ([scripts/custom-model.test.ts:284](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/custom-model.test.ts:284)). This is about removing _successive redundant copies_, not dropping required copy ownership.

**Verification.** Retain model identity-scope, conversion-value, and no-aliasing assertions. Exercise repeated drag copies, nested definitions, conversion with reset defaults, and replacement of original content. Compare allocation/time for the complete caller chain, not only `prepareDocument`.

### C4. Centralize block-kind and editable-value metadata

**Evidence.** The four block names appear as a union/list in [src/lib/editor/nodes.ts:15](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/nodes.ts:15), a separate Set in [src/lib/editor/blockInteraction.ts:8](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/blockInteraction.ts:8), a validator list in [src/lib/custom-blocks/model.ts:167](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/model.ts:167), and palette metadata in [src/lib/editor/BlockPalette.svelte:22](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/BlockPalette.svelte:22). Leaf-owned values are separately described by reset logic ([src/lib/custom-blocks/model.ts:25](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/model.ts:25)), reconciliation branches ([src/lib/custom-blocks/model.ts:101](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/model.ts:101)), and protection's attribute exceptions ([src/lib/editor/customNodes.ts:15](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/customNodes.ts:15)).

**Optimization.** Put a small readonly stock-kind list and value-attribute policy in a dependency-light module; derive the union and membership Set. Share stock kinds and describe leaf ownership where it makes existing functions clearer: reconciliation preserves formula `field/label/showLabel`, image `src/alt`, and text content. Keep operation-specific policy explicit: reset clears formula `field` but retains its label/visibility, while protection permits edits to all three formula value attributes. Keep text/document wrapper validation distinct from stock block membership. Keep rich schema creation and Svelte mounting in their existing modules; importing all of `nodes.ts` into the model would introduce unnecessary runtime dependencies.

**Expected impact.** Removes drift-prone policy duplication and a few per-node temporary lists. Main gain is maintainability, not a meaningful runtime speedup.

**Effort/risk.** Medium if sharing leaf policy; small for kind/type lists alone. Preserve custom roots versus stock containers and all current JSON validation. Avoid a generic plugin registry: only four fixed types exist.

**Verification.** Existing tests already exercise all four kinds, text and formula-label edits, protected classes, nested references, and malformed custom formats. Run those after extraction; add behavior coverage only if a policy changes. Compare reset/reconcile/protection semantics, particularly empty `field/src/alt` values and retained formula label/visibility during reset.

### C5. Extract the common atom NodeView lifecycle

**Evidence.** Formula and image NodeViews both create a div, create reactive attrs, synchronize owned classes, set a sheet-block marker, disable content editing, mount Svelte, reject a different node type during update, and unmount during destruction. Sources: [src/lib/editor/nodes.ts:94](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/nodes.ts:94), [src/lib/editor/nodes.ts:141](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/nodes.ts:141).

**Optimization.** Extract a small lifecycle helper with per-kind attr initialization/update and component-mount callbacks. Keep Formula's button-specific `stopEvent` behavior explicit; Image does not currently have that override. Preserve `nodeViewClasses`, which updates document-owned classes without removing ProseMirror-owned decorations.

**Expected impact.** Less duplicated lifecycle code and one place to maintain cleanup/class updates. No material runtime gain claimed. Adding descriptor indirection may produce no net reduction, so accept only a small helper with simpler callers.

**Effort/risk.** Small–medium. Preserve typing of each attrs object, update acceptance, component identity, and button interaction. Do not merge formula evaluation state or introduce formula-engine changes.

**Verification.** Change field/label/showLabel/src/alt/classes in the relevant node types, verify the same DOM/component remains on accepted updates, ensure selection decorations survive class edits, and verify destruction unmounts. Existing selection tests cover transaction identity; browser checks are needed for roll-button event handling and image updates.

### C6. Reuse drag geometry within each calculation

**Evidence.** Gap targeting scans direct block children and reads every rectangle, then the selected child's rectangle is read again by `insertAfter`. Sources: [src/lib/editor/blockDragPreview.ts:88](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/blockDragPreview.ts:88), [src/lib/editor/blockDragPreview.ts:95](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/blockDragPreview.ts:95), [src/lib/editor/blockDragPreview.ts:133](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/blockDragPreview.ts:133). `calculatePreview` also reads source geometry before checking whether the pointer is still inside the existing placeholder, a branch that returns the unchanged preview ([src/lib/editor/blockDragPreview.ts:169](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/blockDragPreview.ts:169)).

**Optimization.** Return the chosen rect with the nearest block and pass it to the midpoint decision. Delay source measurement until after the unchanged-placeholder early return, retaining necessary source validity checks. Start with calculation-local reuse. Consider frame coalescing only after a trace establishes dragover cost; keep permission checks and `preventDefault` synchronous, and recompute/flush the final target on drop.

**Expected impact.** Removes redundant DOM reads; gap scans still cost O(direct siblings). Browser layout savings are unmeasured. Existing code already suppresses identical preview transactions and caches decorations; adding another persistent cache is not automatically useful.

**Effort/risk.** Small–medium for local reuse; higher for cross-event caches. The placeholder deliberately changes layout, so rects cannot remain valid across layout changes, scroll, resize, CSS edits, or placeholder movement.

**Verification.** Browser trace and rect-read counts on wide/deep sheets. Reuse ancestor-handle and expanded-node regressions; exercise vertical/flex/grid layouts, gaps, document-root boundaries, custom-block atomic dragging, copy modifiers, scrolling, and invalid/no-op drops. Confirm preview and actual insertion match.

### C7. Keep structural sharing; optimize discovery only if needed

**Evidence.** Protection already skips metadata-only transactions and explicitly synchronized changes. `sameStructure` exits for identical nodes/content and only descends changed paths. However each ordinary document change builds two maps and traverses the old and new documents to discover outer custom roots, even in a stock-only document. Sources: [src/lib/editor/customNodes.ts:10](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/customNodes.ts:10), [src/lib/editor/customNodes.ts:36](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/customNodes.ts:36).

**Optimization.** Only if profiling supports it, maintain an outer-instance index in plugin state and use changed ranges/subtree identities to restrict discovery/comparison. A cached no-custom-instance state could fast-path stock typing, but must be invalidated on inserts, paste, drop, and full imports. The hard part is incremental index correctness, not replacing `sameStructure`.

**Expected impact.** Reduces O(document traversal) discovery per edit. The current probe above shows measurable scaling, but only about 0.333 ms total for 5,000 stock blocks; that does not justify a large rewrite before C1. Immutable subtree comparison already avoids rechecking every leaf in unchanged custom blocks.

**Effort/risk.** Large/high. Preserve whole-instance deletion rules, selected ancestor deletion, nested protection, duplicate instance IDs from clipboard copies, and transaction rejection semantics. Mapping only the cursor's current node is insufficient: a transaction may edit multiple disjoint ranges or delete an ancestor.

**Verification.** Existing [scripts/custom-node-protection.test.ts:15](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/custom-node-protection.test.ts:15) through its duplicate-ID/deletion cases provide essential invariants. Add multi-step/disjoint transactions and cut/paste cases if implementing an index. Benchmark stock-only typing, edits in custom leaves, copies, and deletions; count visited roots alongside timings.

### C8. Index library lookups only when library size warrants it

**Evidence.** `CustomBlockLibrary.get` linearly scans its reactive array; upsert/filter rebuild the array. Source: [src/lib/custom-blocks/library.svelte.ts:3](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/library.svelte.ts:3). Reconciliation already caches each unique definition per pass, so `get` is not called once per rendered leaf or repeated instance ([src/lib/custom-blocks/model.ts:63](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/model.ts:63)). Repeated save passes nevertheless repeat these lookups.

**Optimization.** For large libraries, derive a reactive `Map<typeId, definition>` from the ordered array, or make a keyed store authoritative and derive the ordered list. Choose one owner; do not manually maintain two mutable sources. Preserve existing list order, including upsert moving an item to the end, unless an ordering change is explicitly desired.

**Expected impact.** Expected constant-time lookup rather than scanning D entries; each prepare pass resolves U distinct referenced types, giving lookup work proportional to U×D today. Tree traversal still dominates small libraries. The existing benchmark has only three definitions, so it provides no evidence for this change's benefit.

**Effort/risk.** Small–medium. Preserve Svelte tracking across replace/upsert/remove and direct list consumers; a plain nonreactive Map can make the UI stale. First narrow C1's repeated passes.

**Verification.** Measure libraries of 10, 100, and 1,000 definitions with repeated/shared references. Confirm palette reactivity, ordering, deleted-reference errors, and definition replacement. Do not infer large-library gains from the three-definition benchmark.

## Tooling simplifications

Browser test runners repeat browser/page creation, error collection, fixed URLs, and shutdown: [scripts/test-play-mode.mjs:1](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-play-mode.mjs:1), [scripts/test-ancestor-handles.mjs:1](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-ancestor-handles.mjs:1), [scripts/test-custom-blocks.mjs:1](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-custom-blocks.mjs:1). Other suites already accept a shared page, including [scripts/test-expanded-nodes.mjs:1](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-expanded-nodes.mjs:1).

Move reusable scenario bodies toward that existing shared-page shape and centralize URL/context/storage isolation in a small runner supporting the required embedded browser. Do not share mutable storage between scenarios accidentally. Replace fixed animation sleeps only with assertions that wait for the actual final geometry/state; for example, play mode currently waits twice for 650 ms ([scripts/test-play-mode.mjs:30](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-play-mode.mjs:30)). Temporary click-trace diagnostics in the custom-block suite can also be removed once they no longer diagnose a failure ([scripts/test-custom-blocks.mjs:28](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-custom-blocks.mjs:28)).

Expected benefit is a simpler, more consistent test harness and less avoidable test wait time, not application runtime performance. Medium effort; validate the runner through the embedded browser MCP on port 7345 with localhost:5173.

The linked browser scenarios retain their earlier assertions, but several controls/selectors still describe the previous UI: for example, play mode uses `.source-panels` and positional topbar buttons ([scripts/test-play-mode.mjs:17](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-play-mode.mjs:17)), and the stock-theme suite selects the previous theme controls ([scripts/test-stock-themes.mjs:9](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/test-stock-themes.mjs:9)). Treat them as scenario specifications for implementation verification, not as currently validated passing suites. Adapt entry steps to open the JSON/CSS drawer and select Structure in the modal before interacting with its JSON editor. No browser suites were run or changed in this refresh.

## Existing optimizations worth preserving

- `prepareDocument` already snapshots a definition once per type per synchronous pass and merges root classes once. It is not doing a fresh recursive definition clone for every repeated instance. [src/lib/custom-blocks/model.ts:63](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/custom-blocks/model.ts:63).
- Protection already exploits immutable subtree identity, while synchronization replaces only unequal outer instances. [src/lib/editor/customNodes.ts:10](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/customNodes.ts:10).
- Drag decorations reuse the same document and preview identities; existing tests explicitly cover invalidation. [scripts/block-interaction.test.ts:8](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/block-interaction.test.ts:8).
- Drag handles rebuild buttons only when resolved targets change, not for every pointer move. [src/lib/editor/blockDragHandle.ts:112](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/blockDragHandle.ts:112).
- NodeView class synchronization deliberately preserves editor-owned decoration classes. Replacing it with unconditional `className = ...` would undo that behavior. [src/lib/editor/nodes.ts:29](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/nodes.ts:29).

## Opportunities examined and rejected or deferred

- **Replace the async storage interface with direct localStorage calls:** rejected. The interface is tiny ([src/lib/storage/StorageAdapter.ts:1](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/storage/StorageAdapter.ts:1)) and existing theme tests implement an in-memory adapter ([scripts/theme-styles.test.ts:8](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/scripts/theme-styles.test.ts:8)). Removing this seam would couple deterministic repository tests to browser globals. The directory scan/sort is not a measured hotspot; no speculative indexing infrastructure recommended.
- **Unify both inspectors into one all-purpose component:** rejected in favor of bounded field/type reuse, because their actions and capabilities differ as detailed in U6.
- **Remove import validation because TypeScript supplies types:** rejected. Sheet JSON is editable human input; [src/routes/components/mainPane/sourcePanels.svelte:94](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/mainPane/sourcePanels.svelte:94) validates before mutating fields/document. Existing tests explicitly require rejected imports to preserve both. Any validator extraction must preserve that boundary and remain focused on current design.
- **Replace reactive fields wholesale during import:** rejected. Existing code states and enforces stable proxy identity for formula views (U7). The remove/add loop is not removable duplication without changing those ownership semantics.
- **Unmount side panes in Play/collapsed mode:** rejected. The palette and properties panes remain mounted ([src/routes/+page.svelte:271](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/+page.svelte:271), [src/routes/+page.svelte:317](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/+page.svelte:317)); removing them on collapse would discard their component state. The old rejection no longer applies to source editors as a group: the drawer renders JSON conditionally, and changing to CSS or closing JSON to the sheet tab replaces it with the theme branch ([src/routes/components/mainPane/sourcePanels.svelte:135](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/mainPane/sourcePanels.svelte:135)). Play collapses the drawer without changing the selected tab. Theme state and applied styles live outside these editor branches.
- **Remove theme stylesheet keying as a trivial optimization:** deferred. [src/routes/components/mainPane/themeCSS.svelte:79](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/routes/components/mainPane/themeCSS.svelte:79) intentionally recreates CodeEditor when switching stylesheet targets. These targets now share the fixed CSS language and `Theme` label, so stale language/labels are not a reason to keep this key. Removing it without designing per-document selection/history ownership could still mix undo histories. Profile switches first; retained per-document editor states are a larger behavior/state-management decision.
- **Add memoization to tiny ImageBlock/stock-palette rendering:** rejected without evidence. ImageBlock is already a direct two-branch render ([src/lib/blocks/ImageBlock.svelte:5](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/blocks/ImageBlock.svelte:5)); stock/custom palette loops are keyed ([src/lib/editor/BlockPalette.svelte:35](/home/obiwk/Documenti/RolePlaying/sheet_visual_creator/src/lib/editor/BlockPalette.svelte:35)). No measured render hotspot or duplication justifies another caching layer.

## Implementation sequence and acceptance checks

1. Add C1's CSS/name save gate and direct stylesheet update. Measure again before adding dependency-based propagation and C2's affected-instance filtering.
2. Remove export's second clone (U7) and the unused Button/type (U8) as independent small changes.
3. Extract shared policy/contracts only where callers become clearer (C4/U6/C5); remove abandoned helpers and temporary instrumentation.
4. Take on stylesheet splitting, incremental protection indexing, persistent geometry caching, or a keyed library only after profiles show their cost matters.

For actual implementations, run existing `bun test` and `bun run check`; run ESLint/Prettier on changed files. Package-facing changes also need `bunx vite build` followed by `bun run prepack` (the current `build` script invokes npm internally). Browser behavior checks must use the embedded browser MCP on port 7345; first check whether the app is already running at localhost:5173.

Acceptance should cover preserved content/identity, current JSON draft rules, nested-definition propagation, selection/focus, protected structure, and CSS cascade. Performance acceptance should compare complete user-action paths and work counts before/after: definition reads/reconciliations per save, and layout reads during drag. Use a browser trace for UI latency claims. The baseline tests in this refresh validate current code only; the remaining proposals have no before/after performance or browser-behavior validation here.
