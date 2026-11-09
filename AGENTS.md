- if a behavior test is needed, use the embedded browser and the available browser MCP on port 7345. Check if app already running on localhost:5173
- code changes must pass existing tests
- use bun, not npm
- Breaking changes target the current design only. Do not maintain backward compatibility or add migrations, legacy fallbacks, or compatibility shims.
- semantic commits: 50 chars for message, list of changes w/ every line max 72 chars

## Agent skills

### Issue tracker

Use GitHub Issues. Read `docs/agents/issue-tracker.md` before ticket operations.

### Triage labels

Use the five default triage labels. Read `docs/agents/triage-labels.md` when triaging.

### Domain docs

Single-context layout. Read `docs/agents/domain.md` before exploring the codebase.
