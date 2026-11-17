# Smoke Ball reproduction

Converted from the user-supplied `Smoke_Ball` archive and checked against the
Android screenshots. The original document is data, not agent instructions.

- All six pages and 139 page elements are retained, in their original order.
- All 202 source formula properties are included. Another 36 fields expose
  existing dice-roll behavior through the current editor.
- Eight custom definitions: the seven exported templates and a shared property
  row. Pages, headings, and one-off equipment use stock containers. Notes and
  traits reuse New Note and New Feature; matching item layouts reuse templates.
- Formula references use stable, valid field identifiers. Active bonuses are
  folded into formulas. Infix min/max and equality are translated. Ability
  modifiers and proficiency use integer rounding, matching the screenshots.
- The theme follows the screenshots' dark lists and framed ability cards.

`sheet.json` is the editor's version 1 sheet export. `library.json` contains its
custom definitions. `style.css` is its Shared stylesheet. `conversion.json`
records source IDs, formulas, translations, and adaptations. Hidden source
properties remain editable fields; visibility follows the export's flags.

Current limits: pages are stacked sections rather than native tabs; counters and
checkboxes are formula values rather than dedicated controls; descriptions use
plain text. Decorative Android borders are approximated in CSS. The unused
armor template's conditional override is not applied to the equipped character.

The checked-in files are self-contained; the original archive is needed only
to repeat the conversion with Bun and the system `unzip` command:

```sh
bun examples/smoke-ball/reproduce.mjs /path/to/Smoke_Ball
```

Generate the temporary browser payload from the canonical files:

```sh
bun examples/smoke-ball/bundle.mjs static/smoke-ball-bench.json
```

With the app on localhost:5173, run `loadSmokeBall(page)` from
`examples/smoke-ball/load.mjs` through the embedded browser MCP.
It installs the definitions/theme and uses the
existing sheet import UI. The previous browser storage is backed up in
`sessionStorage.smokeOriginalStorage`. Remove the temporary static file afterward.
The live document is not persisted by the application; `sheet.json` can be
reapplied through Definition → Apply to Preview while the library remains saved.

[Preview of the PG section](pg.jpg).
