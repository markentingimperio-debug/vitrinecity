# LIA flexible media routing v96

Overlay for the v95 product-reference installation. Work in progress until the exact revision passes CI and its Sonar quality gate. No deployment to a VPS is performed by this pull request.

Goals: recognize conversational Portuguese and bounded spelling variants in media requests without changing the original prompt; distinguish output media from an input photo; abstain on ambiguous ad/commercial requests; block negated generation before preparing a charge. Preserve private reference ownership, explicit quote confirmation, native audio and operations.

The installer must preserve the active image configuration and data mounts and must never perform a Git checkout or restore an old production database. Verification is isolated and never calls a real paid provider.
