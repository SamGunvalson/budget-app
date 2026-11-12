---
name: verify
description: Run this repo's lint, unit tests, and production build through the low-cost verifier agent and report only failures. Use before committing or when asked to check that changes work.
---

# Verify

Delegate to the `verifier` agent so lint, test, and build output stays out of
the main conversation. Pass along any scope the user gave: $ARGUMENTS

If the `verifier` agent is not available, run `npm run verify` directly and
show only failing output.

Relay the result as one line per check, followed by the failures with file and
line. State which checks were not run (auth-service, self-host smoke, and RLS
tests need Docker and are skipped by default).
