#!/usr/bin/env bash
# PostToolUse hook (Write|Edit): lint only the file Claude just edited.
# Silent on success (zero tokens). On ESLint errors, exits 2 so the
# findings are fed straight back to Claude instead of surfacing later
# in a full `npm run lint`.
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
case "$f" in
  *.js|*.jsx) ;;
  *) exit 0 ;;
esac
case "$f" in
  */node_modules/*|*/dist/*|*/android/*) exit 0 ;;
esac
[ -f "$f" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
out=$(node_modules/.bin/eslint --quiet --no-warn-ignored "$f" 2>&1) && exit 0
printf 'ESLint errors in %s:\n%s\n' "$f" "$out" | head -40 >&2
exit 2
