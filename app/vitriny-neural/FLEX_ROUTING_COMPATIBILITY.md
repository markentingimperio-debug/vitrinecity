# Flexible media overlay compatibility

PR 213 adds a hash-pinned overlay for the v95 production runtime under `ops/lia-flex-media`. The unpatched repository application is not the production checkout, so deployment must not use a generic Git pull/build.

This note keeps the application's path-filtered Neural and native-audio regressions in the PR diff. Their tests and runtime source are not weakened. The new dedicated suite separately reconstructs the exact managed v95 application, applies v96 and tests private references, confirmed billing, audio preservation and Docker code-only rollback in both audio configurations.

The overlay does not add Portuguese TTS, language selection, generic vision analysis or recurring-character identity guarantees. The language feature is tracked separately in issue 214.
