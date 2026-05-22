# Changelog

All notable changes to Tau will be documented in this file.

## Unreleased

- Widened the slash command overlay to align with the composer padding on both sides.
- Display compaction token counts in `/compact`, compaction events, and restored compaction summaries.
- Added an experimental `tau.useSdkInsteadOfRpc` setting that runs Pi through an in-process SDK adapter while keeping RPC as the default transport.
- Re-enabled `/tree` in SDK mode with a sidebar session-tree navigator, right-side tree toolbar button, Pi-like tree formatting, inline branch-summary choices, boxed branch-summary transcript callouts, and branch-only tree indentation for moving the live session branch.
- Render session-tree branch summaries inline instead of as boxed callouts.
- Bundled the experimental Pi SDK transport with tree-shaking to avoid shipping the full Pi SDK dependency tree in the VSIX.

## 1.0.0 - Initial release

- Initial release.
