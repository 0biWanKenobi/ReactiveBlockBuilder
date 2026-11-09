# Code optimization deep dive

Reviewed **2026-11-09**, working tree at **`542a373`**. Report only; no application, test, or configuration changes.

Scope: production source, tests, and tooling outside `src/lib/formula/engine.ts`. That file was not inspected and has no recommendations here. Current design uses expanded custom instances. The older compact-node experiment report describes another implementation; its results are not treated as current evidence. No glossary or ADR files were present.

The strongest opportunities reduce repeated work around the editor: materializing complete JSON while typing, formatting identical CSS during startup, and reconciling unrelated definitions when saving. Several smaller extractions improve consistency; they should not be sold as runtime wins.

## Priority and scope

Impact describes the expected benefit, not a measured improvement from an implemented change. **Small** effort means a bounded local change; **medium** crosses a few callers; **large** changes synchronization or transaction bookkeeping. Performance findings distinguish confirmed repeated work from unmeasured browser benefit.

| Priority      | ID  | Opportunity                                           | Main benefit                              | Effort / risk             |
| ------------- | --- | ----------------------------------------------------- | ----------------------------------------- | ------------------------- |
| First         | U1  | Materialize definition JSON only when needed          | Large-definition typing                   | Medium / medium           |
| First         | U2  | Deduplicate startup CSS formatting                    | Less startup work                         | Small–medium / low        |
| First         | U3  | Avoid CodeMirror string echo                          | Less work per source edit                 | Small / low               |
| First         | U4  | Remove duplicate selection callback                   | Simple repeated-work removal              | Small / low               |
| Next          | C1  | Limit definition-save propagation and CSS reload      | Save cost scales with affected data       | Medium–large / medium     |
| Next          | C2  | Reconcile only affected live custom instances         | Less serialization and rebuilding on save | Medium / medium           |
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

Commands executed against unchanged application source:

- `bun test`: **27 passed, 0 failed; 144 assertions across five files**.
- `bun run check`: **0 errors, 0 warnings**.
- `bun scripts/benchmark-prepare-document.mjs`: results below.

Existing benchmark uses plain JSON definitions and includes three warmups followed by 15 samples, reporting the median. Fixture construction is outside the timed region; node counts include text nodes. Source: [scripts/benchmark-prepare-document.mjs:62](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/benchmark-prepare-document.mjs:62), measurement loop at [scripts/benchmark-prepare-document.mjs:80](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/benchmark-prepare-document.mjs:80).

| Reconciliation workload                       | JSON nodes |  Median |
| --------------------------------------------- | ---------: | ------: |
| Stock tree, depth 12, 40 roots                |      6,361 | 0.51 ms |
| 100 instances, 60 leaves each                 |      8,101 | 0.60 ms |
| 60 parent instances, six nested children each |     12,901 | 1.08 ms |

Additional inline Bun probes used existing ProseMirror fixtures, without creating files:

| Modal serialization pipeline | Generated JSON characters |    Median |
| ---------------------------- | ------------------------: | --------: |
| 100 text blocks              |                    30,155 |  0.237 ms |
| 1,000 text blocks            |                   301,055 |  1.992 ms |
| 5,000 text blocks            |                 1,509,055 | 10.448 ms |

Pipeline: `JSON.stringify(ensureNodeIds(doc.toJSON().content[0]), null, 2)`, matching the conversion/normalization/stringification within modal synchronization. Each text block had a unique stable ID and the same 62-character string (`Editable text long enough to represent sheet labels and values`); root was a container. Ten warmups, 51 samples, median. The fixture schema supplies default scalar attrs. Sources: [src/lib/custom-blocks/CustomBlockEditorModal.svelte:73](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:73), [scripts/fixtures/editor.ts:13](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/fixtures/editor.ts:13).

A second probe compared identical `EditorState.applyTransaction(state.tr.insertText('!', 2))` calls with and without `CustomNodeProtection`. Each sample started from the same immutable state; 20 warmups, 101 samples:

| Edit workload                                                      | Without protection | With protection |
| ------------------------------------------------------------------ | -----------------: | --------------: |
| 100 stock text blocks                                              |          0.0067 ms |       0.0243 ms |
| 1,000 stock text blocks                                            |          0.0069 ms |       0.0570 ms |
| 5,000 stock text blocks                                            |          0.0133 ms |       0.1778 ms |
| Stock edit before 100 unchanged custom instances, 60 leaves each   |          0.0027 ms |       0.0423 ms |
| Stock edit before 1,000 unchanged custom instances, 60 leaves each |          0.0027 ms |       0.1441 ms |

These are single-machine **Bun 1.3.14 / Windows CPU microbenchmarks**, not browser latency or before/after results. No DOM updates, Svelte scheduling, CodeMirror replacement, layout, paint, or reactive library proxies are included. Sub-millisecond results are sensitive to runtime noise. They support prioritizing serialization over a new protection index, not a promised speedup. Browser behavior suites and production build were not run for this report.

## Detailed UI findings

### U1. Stop regenerating the complete definition JSON on every preview edit

**Evidence.** [src/lib/custom-blocks/CustomBlockEditorModal.svelte:73](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:73) calls `editor.getJSON()`, checks the root, and runs `ensureNodeIds` through `currentStructure`. [src/lib/custom-blocks/CustomBlockEditorModal.svelte:83](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:83) then pretty-prints the result. `onUpdate` invokes this path after each preview content update unless the user has an unapplied JSON draft ([src/lib/custom-blocks/CustomBlockEditorModal.svelte:105](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:105)). It does so even while the CSS tab is active; the JSON CodeEditor only exists in the Structure branch ([src/lib/custom-blocks/CustomBlockEditorModal.svelte:269](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:269)).

The document-identity guard at line 86 already suppresses a second serialization when an inspector callback follows `onUpdate` for the same document. Do not claim that each inspector keystroke necessarily serializes twice. Its limitation is that every actual changed document still triggers whole-document conversion and pretty-printing. `resetValues` also separately assigns `JSON.stringify(reset, null, 2)` after `setContent`, which already enters the update/sync path ([src/lib/custom-blocks/CustomBlockEditorModal.svelte:163](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:163)).

**Optimization.** Separate preview revision tracking from JSON materialization. At minimum, invalidate cached JSON while CSS is active and regenerate once when Structure becomes visible or the user clicks From preview. While Structure is visible, coalesce rapid updates if measurement warrants it. Keep Save/Navigate bound to the current editor document, not the delayed text cache. Preserve `jsonDraftEdited` as a separate flag: it represents unapplied user input, whereas invalidated generated JSON represents stale derived output. Centralize reset synchronization through the same path rather than assigning another serialized copy.

**Expected impact, hypothesis.** Eliminates complete JSON conversions/stringifications during hidden-tab preview edits and reduces transient strings. Benefit scales with definition size and input frequency. The CPU-only pipeline probe above measured 1.992 ms for 1,000 blocks and 10.448 ms for 5,000; savings from the proposed change have not been measured. Does not accelerate editor transaction processing itself.

**Effort/risk.** Medium. Main risk is overwriting unapplied JSON or using stale JSON during Save/Close/Navigate. Preserve dirty checking against semantic editor content; document identity alone must not mark a document permanently dirty after undo returns to its original content.

**Meaningful verification.** Reuse the unapplied-draft/reset scenarios at [scripts/test-expanded-nodes.mjs:112](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-expanded-nodes.mjs:112), plus nested navigation later in that suite. Add a browser scenario that edits preview text repeatedly with CSS active, counts serialization calls, switches back to Structure, and compares JSON with the current preview. Check immediate Save after typing, undo back to original, explicit From preview over an unapplied draft, and closing without false discard prompts. Run browser behavior through the embedded browser MCP on port 7345 against localhost:5173; run existing `bun test` and `bun run check` after implementation.

### U2. Avoid formatting identical theme text twice during initialization

**Evidence.** Initialization waits for `format(stored, section)` and `format(defaults, section)` for every theme stylesheet before clearing `loading` ([src/routes/components/mainPane/themeCSS.svelte:54](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/themeCSS.svelte:54)). There are five IDs ([src/lib/themes/styles.ts:69](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/themes/styles.ts:69)), hence ten calls. A fresh repository returns the same default strings, as asserted by [scripts/theme-styles.test.ts:20](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/theme-styles.test.ts:20). Consequently each of the five default texts is formatted twice on a fresh theme. The formatter already dynamically imports Prettier and its CSS plugin ([src/routes/components/mainPane/themeCSS.svelte:117](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/themeCSS.svelte:117)); this finding does not claim ten independent module downloads.

**Optimization.** Deduplicate pending formatting by exact CSS input within initialization, sharing the resulting promise/string for stored and reset-default text. An alternative is to keep canonical formatted defaults as a build-time source artifact, but that changes maintained source and requires checking whitespace-sensitive expectations. If deferring unopened sections, preserve current formatting when the user first opens a section.

**Expected impact, hypothesis.** Fresh themes need five formatting computations rather than ten; saved themes benefit only when inputs match. May shorten the loading-disabled interval. Module caching already addresses repeated imports, so merely hoisting `import()` is not the main gain.

**Effort/risk.** Low to medium. Retain the existing stale-input check before committing formatted text. Do not remove formatting wholesale: [scripts/test-stock-themes.mjs:76](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-stock-themes.mjs:76) explicitly expects formatted CSS after a saved unformatted stylesheet reloads. Empty CSS, comments, and malformed drafts must retain current behavior.

**Meaningful verification.** Count formatter invocations and time initialization for fresh, partially customized, and fully customized storage. Run stock-theme browser scenarios for save/reload, formatting, discard/reset, and deliberately empty styles; inspect dirty markers before and after loading.

### U3. Remove CodeEditor document-string echo work

**Evidence.** The CodeMirror update listener converts its document to a string and calls `onChange` ([src/lib/editor/CodeEditor.svelte:49](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/CodeEditor.svelte:49)). Current parents immediately store that string back into `value`: sheet JSON ([src/routes/components/mainPane/sourcePanels.svelte:145](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/sourcePanels.svelte:145)), theme CSS ([src/routes/components/mainPane/themeCSS.svelte:175](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/themeCSS.svelte:175)), and modal JSON/CSS ([src/lib/custom-blocks/CustomBlockEditorModal.svelte:277](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:277)). Its synchronization effect then calls `view.state.doc.toString()` again to discover that its document already matches the echoed prop ([src/lib/editor/CodeEditor.svelte:66](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/CodeEditor.svelte:66)). The existing equality guard correctly avoids dispatching a replacement transaction on every keystroke, but still recomputes the document string for that comparison.

**Optimization.** Cache the last document string at the CodeEditor boundary. Update it before emitting `onChange`, and after applying an external `value`; compare incoming props with this cache first. Preserve the `synchronizing` guard so programmatic formatting/import does not turn into another user edit or mark modal JSON as unapplied.

**Expected impact, hypothesis.** Removes a repeated document-to-string operation per echoed edit. This does not eliminate the first serialization required by the current string-valued component API. Likely meaningful mainly for large JSON; no allocation size or duration measured.

**Effort/risk.** Low. Cache must reflect external replacements as well as local edits. Parent callbacks that normalize input must still apply their changed value rather than being mistaken for an echo.

**Meaningful verification.** Use a large JSON editor and record `toString` call counts around typing. Verify one `onChange` for a user edit, zero feedback callbacks for external format/import/reset, unchanged caret during ordinary typing, and the existing unapplied-JSON protection. Also test a parent that transforms the emitted string. Avoid asserting private implementation details beyond the instrumentation used to assess performance.

### U4. Remove duplicate modal selection notifications; retain attribute updates

**Evidence.** Both `onSelectionUpdate` and `onTransaction` invoke `synchronizeSelection` on the same modal editor ([src/lib/custom-blocks/CustomBlockEditorModal.svelte:105](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:105)). The selected-block helper copies attributes and resolves ancestors each time ([src/lib/editor/selection.ts:12](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/selection.ts:12)). Installed Tiptap implementation emits `transaction`, then also `selectionUpdate` when that applied transaction changed selection ([node_modules/@tiptap/core/src/Editor.ts:730](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/node_modules/@tiptap/core/src/Editor.ts:730)). Therefore the modal calls the same helper twice for a selection-changing applied transaction. This conclusion comes from installed primary source, not an assumed event contract.

**Optimization.** Keep `onTransaction`; remove the redundant `onSelectionUpdate` handler. Optionally avoid assigning an equivalent selected-block snapshot for transactions that do not change the relevant selection/attributes/ancestor context, but treat that as a separate change. The main inspector currently has only one transaction subscription ([src/routes/components/inspector.svelte:31](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/inspector.svelte:31)); it does not have this duplicate subscription.

**Expected impact, hypothesis.** One helper invocation rather than two on modal selection-changing transactions; less duplicate attribute-copy and ancestor-resolution work. Likely modest absolute savings.

**Effort/risk.** Low for removing just the redundant subscription. Do not switch both surfaces to `selectionUpdate` alone: typing in inspector fields changes node attributes without necessarily changing selection. Main-inspector rendering also reads drag mode for its delete label ([src/routes/components/inspector.svelte:76](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/inspector.svelte:76)); aggressive snapshot caching must explicitly preserve updates driven by that state.

**Meaningful verification.** Count callback invocations for node selection, caret movement, and attribute-only transactions. Use [scripts/selection.test.ts:46](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/selection.test.ts:46) as existing evidence of selection-preserving attribute edits, then exercise modal selection, nested blocks, and field editing in the embedded browser. Confirm newly selected attrs appear immediately and input focus remains stable.

### U5. Isolate stylesheet updates instead of replacing all theme and block CSS

**Evidence.** A single effect joins all theme drafts and all custom-block styles into one `styleElement.textContent` ([src/routes/components/mainPane/themeCSS.svelte:84](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/themeCSS.svelte:84)). Every theme keystroke therefore rebuilds a text string containing unrelated sections and custom-block CSS. The intended order is explicit: container, text, formula, image, then Shared ([src/lib/themes/styles.ts:80](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/themes/styles.ts:80)), followed by custom-block styles in the theme component.

**Optimization.** First isolate the custom-block stylesheet into a persistent sibling style element so theme edits do not repeatedly replace that unchanged text. If profiling supports it, give each editable stock/Shared section a stable style element in the existing cascade order and update only changed sections. Preserve ordering when definitions are added/deleted. Keep invalid or deliberately empty CSS as user input; do not turn this into an implicit normalization pass.

**Expected impact, hypothesis.** Less concatenation and replacement of unrelated CSS as stylesheet/library size grows. Reduced CSS parsing work is plausible, but actual browser parsing/style-recalculation savings require a performance trace; separating elements does not guarantee less selector matching or layout.

**Effort/risk.** Medium. Cascade order, global `@layer` usage, and arbitrary user-supplied at-rules require comparison against current single-stylesheet behavior. Keep as a profile-first candidate if current CSS payloads are small.

**Meaningful verification.** Reuse [scripts/test-stock-themes.mjs:52](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-stock-themes.mjs:52) for full replacement and retained sibling drafts, [scripts/test-stock-themes.mjs:100](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-stock-themes.mjs:100) for empty CSS, and [scripts/test-expanded-nodes.mjs:212](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-expanded-nodes.mjs:212) for modal isolation. Add competing selectors across stock, Shared, and custom CSS, plus supported at-rules. Compare style-element text mutations and browser performance traces while typing into one small section with many large unrelated block styles.

### U6. Consolidate the selected-block contract and common inspector fields

**Evidence.** The helper already owns a `SelectedEditorBlock` contract ([src/lib/editor/selection.ts:4](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/selection.ts:4)), but the modal inspector declares an identical local structure ([src/lib/custom-blocks/modal-editor/Inspector.svelte:5](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/modal-editor/Inspector.svelte:5)). Main inspector duplicates the fields while narrowing `type` to registered `SheetNodeType` ([src/routes/components/inspector.svelte:22](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/inspector.svelte:22)). Both surfaces render class, formula-field, and image-source inputs and perform selection-preserving updates through `updateBlockAttribute` ([src/routes/components/inspector.svelte:53](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/inspector.svelte:53), [src/lib/custom-blocks/modal-editor/Inspector.svelte:24](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/modal-editor/Inspector.svelte:24)). Both also enforce the same class-edit restriction on custom roots/descendants.

**Optimization.** Reuse the existing selection type directly in the modal and derive the main inspector's narrowed type from it. Consider a small shared block-field fragment/component accepting selected attrs and an attribute-change callback, keeping actions and surrounding layout in each owner. Existing extraction has already centralized position resolution and attribute transactions; extend that seam rather than building a generic inspector framework.

**Expected impact, hypothesis.** Less contract and form duplication; future field changes become easier to keep consistent. No meaningful runtime gain claimed.

**Effort/risk.** Low for type reuse, medium for shared fields. The surfaces intentionally differ: main has image alt text, style navigation, play-mode handling, and icon deletion; modal has nested-definition navigation, preview syncing, and different labels/layout ([src/routes/components/inspector.svelte:118](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/inspector.svelte:118), [src/lib/custom-blocks/modal-editor/Inspector.svelte:33](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/modal-editor/Inspector.svelte:33)). Preserve those differences explicitly. Adding alt editing to the modal is a separate behavior choice, not required for this cleanup.

**Meaningful verification.** Existing [scripts/selection.test.ts:46](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/selection.test.ts:46) covers focus-safe selection-preserving transaction semantics. Browser checks should cover both inspectors, hidden class controls for custom descendants, nested navigation, image alt editing on the main surface, and modal JSON synchronization. Avoid tests that merely mirror a new component's markup.

### U7. Remove the second complete field clone during sheet export

**Evidence.** Export immediately serializes a temporary `SavedSheet`, yet its fields are first copied with `structuredClone($state.snapshot(fields))` ([src/routes/components/mainPane/sourcePanels.svelte:61](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/sourcePanels.svelte:61)). The temporary object never escapes; line 69 immediately passes it to `JSON.stringify`. The installed Svelte snapshot implementation recursively copies plain objects/arrays ([node_modules/svelte/src/internal/shared/clone.js:57](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/node_modules/svelte/src/internal/shared/clone.js:57)). Current field creation/import constructs plain `{ id, formula }` records ([src/routes/components/leftSidebar.svelte:54](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/leftSidebar.svelte:54), [src/routes/components/mainPane/sourcePanels.svelte:117](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/sourcePanels.svelte:117)).

**Optimization.** Serialize `$state.snapshot(fields)` directly; remove the outer `structuredClone`. Keep the snapshot boundary as the explicit plain-data projection. No deferred work or mutation requires a second detached copy here.

**Expected impact, hypothesis.** Removes one complete field-object clone and its allocation per explicit export. Low absolute impact for the sample field set; larger sheets benefit more. This is primarily straightforward simplification.

**Effort/risk.** Low. Check exported JSON equality and absence of field mutations. Do not replace the reactive `fields` object during import: the code explicitly preserves its identity because existing formula views reference it ([src/routes/components/mainPane/sourcePanels.svelte:115](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/sourcePanels.svelte:115)).

**Meaningful verification.** Existing expanded-document round trip at [scripts/test-expanded-nodes.mjs:464](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-expanded-nodes.mjs:464), plus rejected-import field atomicity at [scripts/test-custom-blocks.mjs:140](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-custom-blocks.mjs:140). Compare full exported fields before/after and verify later field edits do not alter the already exported JSON string.

### U8. Remove the unused polymorphic Button component and its private type

**Evidence.** [src/lib/components/Button.svelte:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/components/Button.svelte:1) implements a generic dynamic-tag button, custom key handling, and bound element ownership. A reference search across all `src` and `scripts`, excluding the forbidden formula engine, found no consumers: the component name appears only inside its own file. `HtmlTag` appears only in that component and its declaration at [src/lib/types/shared.ts:5](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/types/shared.ts:5). Neither component nor type is exported by [src/lib/index.ts:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/index.ts:1). Current UI uses native buttons and specialized Switch/Dropdown controls.

**Optimization.** Delete the unused Button component and `HtmlTag`; remove the now-unused `SvelteHTMLElements` type import from shared types. Keep `OpResult`, which the sidebar uses. Do not expand this into converting the many native buttons to a new component merely to justify existing dead abstraction.

**Expected impact.** Removes an unused abstraction and its maintenance surface. No shipped-bundle or runtime improvement claimed: the component is unreferenced.

**Effort/risk.** Low for the current app. Neither item is exported by the public package index. Keep this removal within the current design; no compatibility shim is needed.

**Meaningful verification.** Repeat the reference search at implementation time; run Svelte/type checking and package validation to catch unexpected references. Existing runtime behavior should be unchanged, so a dedicated behavior test would add little value.

## Detailed model and editor findings

### C1. Make definition saves proportional to the change

**Evidence.** Every save validates and writes the candidate and CSS, then iterates over **every definition**, snapshots it, reconciles its full structure, and stringifies both before and after to discover whether anything changed. It then synchronizes the live editor and reloads **every block stylesheet**. No distinction exists for a name-only, CSS-only, or structural edit. Source: [src/routes/+page.svelte:154](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/+page.svelte:154). The all-styles reload is [src/routes/+page.svelte:72](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/+page.svelte:72).

**Optimization.** Split the save operation into explicit responsibilities:

1. Compare candidate with its current definition before upserting; preserve separate name, CSS, and definition-structure/root-class change information. A name/CSS-only edit needs persistence and UI/style updates, not instance reconciliation.
2. For structural/root-class changes, compute the changed type and its transitive dependents. Build direct dependency edges from custom-instance references, stopping at each custom root rather than treating its embedded copied children as independent definition references.
3. Reconcile that affected set against a consistent candidate library. Share definition snapshots across the batch where practical; current loop starts a new cache for every definition. Persist/upsert only results that differ.
4. After successful CSS persistence, update `blockCSS[typeId]` from the submitted string. Keep a full reload for initial storage hydration; delete the relevant entry on deletion. Current local storage has no subscription to external edits that would require a full read after every save.

An initial implementation can keep existing structural reconciliation and only add the name/CSS gate plus targeted CSS update. Dependency tracking can follow if large-library measurements justify it. Avoid replacing string comparisons with hashes unless their maintenance and equality semantics are justified.

**Expected impact.** Confirmed opportunity to eliminate unrelated snapshots, traversals, comparisons, and stylesheet reads. Current save cost follows the aggregate library size even for metadata/CSS edits; proposed work follows the changed type and dependent subset. Actual latency improvement remains unmeasured. `Promise.all` does not move localStorage calls off the main thread: adapter methods directly invoke browser storage ([src/lib/storage/StorageAdapter.ts:12](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/storage/StorageAdapter.ts:12)).

**Effort/risk.** Medium for the first gate/cache update; larger for dependency propagation. Preserve nested-instance value ownership and class propagation. Do not blindly parallelize dependent saves: compute changes from a stable library view before writing, and retain existing error reporting.

**Verification.** Existing nested propagation scenario at [scripts/test-expanded-nodes.mjs:400](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-expanded-nodes.mjs:400). Measure save duration plus reconciliation/read/write counts for CSS-only, name-only, root-class, leaf-default, and layout changes, across independent definitions, dependency chains, and shared children. Assert unrelated definitions are untouched; verify edited CSS is immediately visible and deletion removes only its styles.

### C2. Filter live-instance synchronization by affected type

**Evidence.** `synchronizeCustomNodes` collects every outer custom instance, serializes all of them, reconciles all of them, constructs fresh ProseMirror nodes for all results, and only then uses `node.eq(after)` to avoid unnecessary replacement. The current design already preserves unrelated stock nodes and selection and batches replacements in reverse position order. Source: [src/lib/editor/customNodes.ts:76](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/customNodes.ts:76).

**Optimization.** Accept the affected type set from C1 and filter the collected outer roots before JSON conversion. Include outer types that depend transitively on the edited type, because the traversal intentionally stops at outer custom roots. CSS-only/name-only saves should skip this function entirely. Keep one `prepareDocument` call for the selected batch, the equality check, reverse-order replacements, `customNodeSync`, and `addToHistory: false`.

**Expected impact.** Reduces JSON allocation, reconciliation, `nodeFromJSON`, and equality work when most sheet instances are unrelated. The remaining outer-root discovery scan still follows document size. This is a targeted extension of the existing optimized approach, not a proposal to replace the whole document.

**Effort/risk.** Medium. An incomplete affected set leaves nested instances stale. Whole-instance replacement can still remount changed descendants; optimizing that further would require a more involved tree diff and is not justified by measurements here.

**Verification.** Save a child referenced by multiple outer types and verify every affected occurrence, preserved text/formula/image values, unchanged unrelated node identity, and valid selection mapping. Existing value-evolution/model tests and expanded-node browser suite cover the semantics; add a large mostly-unrelated sheet benchmark for the changed synchronization path.

### C3. Give each tree one clear copy owner

**Evidence.** Several call chains create successive detached copies:

- Palette custom drag: `$state.snapshot(block)` → `makeInstance`'s `structuredClone` → caller's `prepareDocument`; modal drag additionally calls `ensureNodeIds`, which clones again. Sources: [src/lib/editor/BlockPalette.svelte:29](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/BlockPalette.svelte:29), [src/lib/custom-blocks/model.ts:38](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/model.ts:38), [src/lib/custom-blocks/CustomBlockEditorModal.svelte:128](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/CustomBlockEditorModal.svelte:128).
- Conversion creation: `startNewDefinition` normalizes/copies editor JSON, then `createDefinition` reconciles and normalizes/copies again. Sources: [src/routes/+page.svelte:84](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/+page.svelte:84), [src/lib/custom-blocks/model.ts:139](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/model.ts:139).

**Optimization.** Keep safe public copying functions, but separate internal operations on already-owned plain trees from boundary snapshotting. For example, snapshot a reactive definition once, assign instance identity on that owned root, and reconcile once; allow ID normalization to visit an already-detached result without another clone. Consolidate the palette's preparation responsibilities so callers do not each invent a different copy sequence.

For conversion, preserve the **first normalized IDs** shared by `pendingOriginal` and the new definition. Removing that step blindly can generate different IDs in each copy and break later value matching. A single conversion-preparation operation returning both related results would make that invariant explicit.

**Expected impact.** Fewer complete allocations/traversals on definition creation and palette drag, primarily for large custom trees. These are explicit actions rather than each-keystroke paths, so prioritize below U1.

**Effort/risk.** Medium. Reactive proxies must still become plain data before operations requiring cloneable input. Never share mutable result nodes/attrs with definitions or sibling instances; current isolation test explicitly requires detached outputs ([scripts/custom-model.test.ts:255](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/custom-model.test.ts:255)). This is about removing _successive redundant copies_, not dropping required copy ownership.

**Verification.** Retain model identity-scope, conversion-value, and no-aliasing assertions. Exercise repeated drag copies, nested definitions, conversion with reset defaults, and replacement of original content. Compare allocation/time for the complete caller chain, not only `prepareDocument`.

### C4. Centralize block-kind and editable-value metadata

**Evidence.** The four block names appear as a union/list in [src/lib/editor/nodes.ts:15](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/nodes.ts:15), a separate Set in [src/lib/editor/blockInteraction.ts:7](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/blockInteraction.ts:7), a validator list in [src/lib/custom-blocks/model.ts:162](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/model.ts:162), and palette metadata in [src/lib/editor/BlockPalette.svelte:22](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/BlockPalette.svelte:22). Leaf-owned values are separately described by reset logic ([src/lib/custom-blocks/model.ts:25](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/model.ts:25)), reconciliation branches (same file, line 101), and protection's attribute exceptions ([src/lib/editor/customNodes.ts:15](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/customNodes.ts:15)).

**Optimization.** Put a small readonly stock-kind list and value-attribute policy in a dependency-light module; derive the union and membership Set. Share the facts `formula → field`, `image → src/alt`, and text's content ownership where it makes existing functions clearer. Keep text/document wrapper validation distinct from stock block membership. Keep rich schema creation and Svelte mounting in their existing modules; importing all of `nodes.ts` into the model would introduce unnecessary runtime dependencies.

**Expected impact.** Removes drift-prone policy duplication and a few per-node temporary lists. Main gain is maintainability, not a meaningful runtime speedup.

**Effort/risk.** Medium if sharing leaf policy; small for kind/type lists alone. Preserve custom roots versus stock containers and all current JSON validation. Avoid a generic plugin registry: only four fixed types exist.

**Verification.** Existing tests already exercise all four kinds, text edits, protected classes, nested references, and malformed custom formats. Run those after extraction; add behavior coverage only if a policy changes. Compare reset/reconcile/protection semantics, particularly empty `field/src/alt` values.

### C5. Extract the common atom NodeView lifecycle

**Evidence.** Formula and image NodeViews both create a div, create reactive attrs, synchronize owned classes, set a sheet-block marker, disable content editing, mount Svelte, reject a different node type during update, and unmount during destruction. Sources: [src/lib/editor/nodes.ts:92](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/nodes.ts:92), [src/lib/editor/nodes.ts:132](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/nodes.ts:132).

**Optimization.** Extract a small lifecycle helper with per-kind attr initialization/update and component-mount callbacks. Keep Formula's button-specific `stopEvent` behavior explicit; Image does not currently have that override. Preserve `nodeViewClasses`, which updates document-owned classes without removing ProseMirror-owned decorations.

**Expected impact.** Less duplicated lifecycle code and one place to maintain cleanup/class updates. No material runtime gain claimed. Adding descriptor indirection may produce no net reduction, so accept only a small helper with simpler callers.

**Effort/risk.** Small–medium. Preserve typing of each attrs object, update acceptance, component identity, and button interaction. Do not merge formula evaluation state or introduce formula-engine changes.

**Verification.** Change field/src/alt/classes in both node types, verify the same DOM/component remains on accepted updates, ensure selection decorations survive class edits, and verify destruction unmounts. Existing selection tests cover transaction identity; browser checks are needed for roll-button event handling and image updates.

### C6. Reuse drag geometry within each calculation

**Evidence.** Gap targeting scans direct block children and reads every rectangle, then the selected child's rectangle is read again by `insertAfter`. Sources: [src/lib/editor/blockDragPreview.ts:88](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/blockDragPreview.ts:88), [src/lib/editor/blockDragPreview.ts:95](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/blockDragPreview.ts:95), [src/lib/editor/blockDragPreview.ts:133](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/blockDragPreview.ts:133). `calculatePreview` also reads source geometry before checking whether the pointer is still inside the existing placeholder, a branch that returns the unchanged preview ([src/lib/editor/blockDragPreview.ts:169](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/blockDragPreview.ts:169)).

**Optimization.** Return the chosen rect with the nearest block and pass it to the midpoint decision. Delay source measurement until after the unchanged-placeholder early return, retaining necessary source validity checks. Start with calculation-local reuse. Consider frame coalescing only after a trace establishes dragover cost; keep permission checks and `preventDefault` synchronous, and recompute/flush the final target on drop.

**Expected impact.** Removes redundant DOM reads; gap scans still cost O(direct siblings). Browser layout savings are unmeasured. Existing code already suppresses identical preview transactions and caches decorations; adding another persistent cache is not automatically useful.

**Effort/risk.** Small–medium for local reuse; higher for cross-event caches. The placeholder deliberately changes layout, so rects cannot remain valid across layout changes, scroll, resize, CSS edits, or placeholder movement.

**Verification.** Browser trace and rect-read counts on wide/deep sheets. Reuse ancestor-handle and expanded-node regressions; exercise vertical/flex/grid layouts, gaps, document-root boundaries, custom-block atomic dragging, copy modifiers, scrolling, and invalid/no-op drops. Confirm preview and actual insertion match.

### C7. Keep structural sharing; optimize discovery only if needed

**Evidence.** Protection already skips metadata-only transactions and explicitly synchronized changes. `sameStructure` exits for identical nodes/content and only descends changed paths. However each ordinary document change builds two maps and traverses the old and new documents to discover outer custom roots, even in a stock-only document. Sources: [src/lib/editor/customNodes.ts:10](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/customNodes.ts:10), [src/lib/editor/customNodes.ts:34](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/customNodes.ts:34).

**Optimization.** Only if profiling supports it, maintain an outer-instance index in plugin state and use changed ranges/subtree identities to restrict discovery/comparison. A cached no-custom-instance state could fast-path stock typing, but must be invalidated on inserts, paste, drop, and full imports. The hard part is incremental index correctness, not replacing `sameStructure`.

**Expected impact.** Reduces O(document traversal) discovery per edit. Probe above shows measurable scaling, but only about 0.178 ms total for 5,000 stock blocks here; that does not justify a large rewrite before U1/U3/C1. Immutable subtree comparison already avoids rechecking every leaf in unchanged custom blocks.

**Effort/risk.** Large/high. Preserve whole-instance deletion rules, selected ancestor deletion, nested protection, duplicate instance IDs from clipboard copies, and transaction rejection semantics. Mapping only the cursor's current node is insufficient: a transaction may edit multiple disjoint ranges or delete an ancestor.

**Verification.** Existing [scripts/custom-node-protection.test.ts:15](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/custom-node-protection.test.ts:15) through its duplicate-ID/deletion cases provide essential invariants. Add multi-step/disjoint transactions and cut/paste cases if implementing an index. Benchmark stock-only typing, edits in custom leaves, copies, and deletions; count visited roots alongside timings.

### C8. Index library lookups only when library size warrants it

**Evidence.** `CustomBlockLibrary.get` linearly scans its reactive array; upsert/filter rebuild the array. Source: [src/lib/custom-blocks/library.svelte.ts:3](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/library.svelte.ts:3). Reconciliation already caches each unique definition per pass, so `get` is not called once per rendered leaf or repeated instance ([src/lib/custom-blocks/model.ts:63](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/model.ts:63)). Repeated save passes nevertheless repeat these lookups.

**Optimization.** For large libraries, derive a reactive `Map<typeId, definition>` from the ordered array, or make a keyed store authoritative and derive the ordered list. Choose one owner; do not manually maintain two mutable sources. Preserve existing list order, including upsert moving an item to the end, unless an ordering change is explicitly desired.

**Expected impact.** Expected constant-time lookup rather than scanning D entries; each prepare pass resolves U distinct referenced types, giving lookup work proportional to U×D today. Tree traversal still dominates small libraries. The existing benchmark has only three definitions, so it provides no evidence for this change's benefit.

**Effort/risk.** Small–medium. Preserve Svelte tracking across replace/upsert/remove and direct list consumers; a plain nonreactive Map can make the UI stale. First narrow C1's repeated passes.

**Verification.** Measure libraries of 10, 100, and 1,000 definitions with repeated/shared references. Confirm palette reactivity, ordering, deleted-reference errors, and definition replacement. Do not infer large-library gains from the three-definition benchmark.

## Tooling simplifications

Browser test runners repeat browser/page creation, error collection, fixed URLs, and shutdown: [scripts/test-play-mode.mjs:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-play-mode.mjs:1), [scripts/test-ancestor-handles.mjs:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-ancestor-handles.mjs:1), [scripts/test-custom-blocks.mjs:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-custom-blocks.mjs:1). Other suites already accept a shared page, including [scripts/test-expanded-nodes.mjs:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-expanded-nodes.mjs:1).

Move reusable scenario bodies toward that existing shared-page shape and centralize URL/context/storage isolation in a small runner supporting the required embedded browser. Do not share mutable storage between scenarios accidentally. Replace fixed animation sleeps only with assertions that wait for the actual final geometry/state; for example, play mode currently waits twice for 650 ms ([scripts/test-play-mode.mjs:30](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-play-mode.mjs:30)). Temporary click-trace diagnostics in the custom-block suite can also be removed once they no longer diagnose a failure ([scripts/test-custom-blocks.mjs:28](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/test-custom-blocks.mjs:28)).

Expected benefit is a simpler, more consistent test harness and less avoidable test wait time, not application runtime performance. Medium effort; validate the runner through the embedded browser MCP on port 7345 with localhost:5173.

## Existing optimizations worth preserving

- `prepareDocument` already snapshots a definition once per type per synchronous pass and merges root classes once. It is not doing a fresh recursive definition clone for every repeated instance. [src/lib/custom-blocks/model.ts:63](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/custom-blocks/model.ts:63).
- Protection already exploits immutable subtree identity, while synchronization replaces only unequal outer instances. [src/lib/editor/customNodes.ts:10](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/customNodes.ts:10).
- Drag decorations reuse the same document and preview identities; existing tests explicitly cover invalidation. [scripts/block-interaction.test.ts:6](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/block-interaction.test.ts:6).
- Drag handles rebuild buttons only when resolved targets change, not for every pointer move. [src/lib/editor/blockDragHandle.ts:111](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/blockDragHandle.ts:111).
- NodeView class synchronization deliberately preserves editor-owned decoration classes. Replacing it with unconditional `className = ...` would undo that behavior. [src/lib/editor/nodes.ts:29](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/nodes.ts:29).

## Opportunities examined and rejected or deferred

- **Replace the async storage interface with direct localStorage calls:** rejected. The interface is tiny ([src/lib/storage/StorageAdapter.ts:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/storage/StorageAdapter.ts:1)) and existing theme tests implement an in-memory adapter ([scripts/theme-styles.test.ts:6](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/scripts/theme-styles.test.ts:6)). Removing this seam would couple deterministic repository tests to browser globals. The directory scan/sort is not a measured hotspot; no speculative indexing infrastructure recommended.
- **Unify both inspectors into one all-purpose component:** rejected in favor of bounded field/type reuse, because their actions and capabilities differ as detailed in U6.
- **Remove import validation because TypeScript supplies types:** rejected. Sheet JSON is editable human input; [src/routes/components/mainPane/sourcePanels.svelte:93](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/sourcePanels.svelte:93) validates before mutating fields/document. Existing tests explicitly require rejected imports to preserve both. Any validator extraction must preserve that boundary and remain focused on current design.
- **Replace reactive fields wholesale during import:** rejected. Existing code states and enforces stable proxy identity for formula views (U7). The remove/add loop is not removable duplication without changing those ownership semantics.
- **Unmount source panels and side panes in Play/collapsed mode:** rejected. Existing implementation deliberately retains mounted editors ([src/routes/+page.svelte:396](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/+page.svelte:396)); removing hidden controls would discard editor state and require reinitialization. Optimize hidden derived work instead.
- **Remove theme stylesheet keying as a trivial optimization:** deferred. [src/routes/components/mainPane/themeCSS.svelte:173](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/routes/components/mainPane/themeCSS.svelte:173) intentionally recreates CodeEditor when switching targets. CodeEditor sets language/label only on mount ([src/lib/editor/CodeEditor.svelte:23](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/CodeEditor.svelte:23)). Removing keying without designing per-document selection/history ownership could mix undo histories or stale labels. Profile switches first; retained per-document editor states are a larger behavior/state-management decision.
- **Add memoization to tiny ImageBlock/stock-palette rendering:** rejected without evidence. ImageBlock is already a direct two-branch render ([src/lib/blocks/ImageBlock.svelte:1](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/blocks/ImageBlock.svelte:1)); stock/custom palette loops are keyed ([src/lib/editor/BlockPalette.svelte:39](C:/Users/stefano.laterra/Documents/Coding/ReactiveBlockBuilder/src/lib/editor/BlockPalette.svelte:39)). No measured render hotspot or duplication justifies another caching layer.

## Implementation sequence and acceptance checks

1. Start with bounded removals: duplicate modal selection notification (U4), export's second clone (U7), unused Button/type (U8). Each can remain an independent small change.
2. Address repeated source work: startup formatting deduplication (U2), CodeEditor echo (U3), then modal JSON materialization (U1). Measure with representative large definitions, not only the sample sheet.
3. Add C1's CSS/name save gate and direct stylesheet update. Measure again before adding dependency-based propagation and C2's affected-instance filtering.
4. Extract shared policy/contracts only where callers become clearer (C4/U6/C5); remove abandoned helpers and temporary instrumentation.
5. Take on stylesheet splitting, incremental protection indexing, persistent geometry caching, or a keyed library only after profiles show their cost matters.

For actual implementations, run existing `bun test` and `bun run check`; run ESLint/Prettier on changed files. Package-facing changes also need `bunx vite build` followed by `bun run prepack` (the current `build` script invokes npm internally). Browser behavior checks must use the embedded browser MCP on port 7345; first check whether the app is already running at localhost:5173.

Acceptance should cover preserved content/identity, current JSON draft rules, nested-definition propagation, selection/focus, protected structure, and CSS cascade. Performance acceptance should compare complete user-action paths and work counts before/after: serialization while typing, formatter invocations at startup, definition reads/reconciliations per save, and layout reads during drag. Use a browser trace for UI latency claims. The baseline tests in this report validate current code only; none of these proposed refactorings has been implemented or behavior-tested.
