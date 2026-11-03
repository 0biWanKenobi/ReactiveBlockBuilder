# Issue tracker: GitHub

Issues and specs live in GitHub Issues for
`0biWanKenobi/ReactiveBlockBuilder`. Use the `gh` CLI from this repo.

## Conventions

- Verify the target with `gh repo view --json nameWithOwner` before the
  first write of a session.
- Create: `gh issue create --title "..." --body-file <path>`.
  Use a UTF-8 file for multiline bodies.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open`, adding label filters as needed.
- Comment: `gh issue comment <number> --body-file <path>`.
- Label: `gh issue edit <number> --add-label "..."` or
  `--remove-label "..."`.
- Close: post the explanation as a comment, then run
  `gh issue close <number>`.
- Link parent and child issues using native sub-issues when available.
  Otherwise, add `Part of #<parent>` to the child and a task-list link
  to the parent.
- Record blockers using native issue dependencies when available.
  Otherwise, add `Blocked by: #<number>, #<number>` to the child.
  An issue is unblocked when every blocker is closed.

## Skill instructions

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the referenced GitHub issue.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Tickets: child issues labelled `wayfinder:<type>`, where type is
  `research`, `prototype`, `grilling`, or `task`.
- Frontier: open, unblocked, unassigned children; first in map order wins.
- Claim: assign the ticket to the driving developer before work.
- Resolve: comment with the answer, close the ticket, and add a brief
  result and link to the map's Decisions-so-far.
