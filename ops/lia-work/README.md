# Lia Work

The main VitrineCity application serves the private chat, wallet, tool catalog,
progress line, source links, and media previews. `app/vitriny-neural/lia-chat-operations.js`
reserves Vitrine Coins in the canonical account wallet, sends authenticated tasks
to the dedicated Lia gateway, settles confirmed consumption, and releases unused
reserves. Its routes are scoped to the signed-in account.

The dedicated VPS runs `gateway/server.mjs`, `gateway/operations-router.mjs`, and
`worker/server.mjs` as separate services. The gateway handles task admission,
account workspaces, browser and media operations, and private artifact access.
The coding worker edits only its assigned workspace. Browser research reads public
pages and passes source excerpts to the model for analysis.

Image and short video generation use the existing paid chat runtime in the main
application. The chat shows live progress and stores generated files privately.
Hostinger, Gmail, and external video editor MCP connections are listed as pending
until each application has its own account authorization and server-side connector.
Codex desktop connector tokens are not shared with Lia.

Keep service tokens in the deployment environment, never in this repository.
Deploy the main app and dedicated services separately, then verify the private
chat, wallet settlement, code artifact, public research citations, and media
delivery from a signed-in account. Do not restart the main app during an
unresolved paid media request; reconcile it first to prevent duplicate work.
