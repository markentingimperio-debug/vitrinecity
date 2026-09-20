# Compatibility requirement for flexible routing (PR 213)

The v96 overlay consumes the immutable v92 deployment helper already installed by the owner. It requires the original preservation, deployment, initialization and image-route validation workflows to pass on the exact PR head, in addition to its own real-Docker overlay suite.

This note intentionally keeps those path-filtered compatibility workflows in the pull-request diff. It does not modify their tests, disable their gates, change their source hashes, or authorize a production deployment. The new suite lives in `ops/lia-flex-media` and applies the two-file overlay to a reconstructed hash-checked v95 runtime.
