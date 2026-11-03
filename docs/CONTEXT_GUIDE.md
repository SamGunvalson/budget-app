# Working with AI on Budget App

Give the assistant a bounded task, the relevant existing implementation, and measurable completion criteria. Review changes before running database or deployment commands.

## Choose the right context

| Work | Reference |
| --- | --- |
| Architecture, helpers, and coding invariants | [Contributor instructions](../.github/copilot-instructions.md) |
| Database fields, relationships, and RPCs | [Data model](./DATA_MODEL.md) |
| Component patterns and both themes | [Style guide](./STYLE_GUIDE.md) |
| Auth, RLS, imports, offline cleanup, and deployment boundaries | [Security model](./SECURITY.md) and [checklist](./SECURITY_CHECKLIST.md) |
| Environment, initialization, or upgrades | [Setup guide](./SETUP_GUIDE.md) |

Do not create another conventions file or copy schema definitions into prompts as a new source of truth. Link to the current reference and identify the relevant section.

## Workflow

1. **Define:** state the intended behavior, what is out of scope, and how it will be verified.
2. **Inspect:** identify existing components, hooks, services, and helpers before proposing new abstractions.
3. **Implement:** make a cohesive change using those existing surfaces.
4. **Review:** check the diff against the data model, security invariants, and style guide.
5. **Validate:** run the [relevant checks](./SETUP_GUIDE.md#validation), including offline/online and theme behavior where affected.
6. **Iterate:** provide the exact failure and expected behavior rather than requesting an unrelated rewrite.

## Example: changing a transaction view

> Update the existing transaction list to show the selected month's rows.
> Use the React Query hooks and offline wrappers described in the contributor
> instructions, not direct backend queries from the component.
> Preserve historical archived categories and soft-delete filtering.
> Reuse the currency/date/classification helpers in `src/utils/helpers.js`,
> including safe-mode masking and local date parsing.
> Follow the style guide in both themes. Keep existing edit callbacks.
> Verify loading/error states, income debits, spending credits, and offline reads.

This gives the assistant the data boundary and desired behavior without duplicating an SQL query or inventing another transaction component.

## Review questions

- Do fields and return shapes match the existing service/RPC contract?
- Are reads and writes using the appropriate existing abstraction?
- Are amounts still integer cents, with safe-mode helpers used for display?
- Are date-only strings parsed locally?
- Are auth, RLS, soft deletes, and offline sync preserved?
- Are errors surfaced through the existing UI/logging patterns?
- Are all consumers and directly related guides updated?
- Does validation cover the actual requirement rather than just compilation?

If a conversation becomes unfocused, summarize verified findings, changed files, unresolved failures, and next steps before starting a fresh one. Do not describe incomplete or unverified work as ready to ship.
