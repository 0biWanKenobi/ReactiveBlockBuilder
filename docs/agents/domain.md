# Domain docs

## Before exploring

- Read `GLOSSARY.md` at the repo root.
- Read decisions in `docs/adr/` relevant to the work.

If these files are absent, proceed silently. The domain-modeling skill
creates them when terminology or decisions are resolved.

## Layout

Single-context repo: one root `GLOSSARY.md` and root `docs/adr/`.
Create domain documents lazily, when their contents are established.

## Vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and tests.
If a needed concept is absent, reconsider the wording or note the gap
for domain-modeling.

## Decisions

Explicitly flag proposals that contradict an existing ADR, identifying
the ADR and explaining why the decision should be reconsidered.
