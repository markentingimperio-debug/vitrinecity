# VitrineCity Cultiva

The first Cultiva release combines local plant records, care notes, an opt-in connection to the existing Lia assistant, the two existing casual puzzles and the authenticated Mini Fazenda. The web entry and PWA scope are `/games/`; Android package is `com.vitrinecity.cultiva`.

## Runtime boundaries

`games-app-routes.js` serves the actual game templates through `games-app-pages.js`. The hub, puzzles and plants are public. `/games/fazenda` requires the same active account as the existing farm and uses the existing farm API; no synthetic production state is introduced. Games uses `/games/entrar` for login and session expiry.

The public HTML injection layer and `prepare-public-highlights.js` exclude `/games/`. Decoration also removes build-injected trackers, root installation prompts, public city chat and credit-center links from the reused original templates. Original site pages retain their existing behavior and invite visitors to install the scoped app.

`public/games/sw.js` precaches an explicit public allowlist. No API, account, farm, Lia or checkout response is cached. Plants and puzzles use browser storage; farm and care/assistant access need a connection. The plant schedule is user-authored and shown in-app; there is no push or background notification promise.

`/games/privacidade`, `/games/dados`, `/games/ajuda` and `/games/regras` provide the app's account information. Deletion uses the existing request workflow, not automatic account deletion. The operations team must execute requests and respond with any required retention explanation.

## Android release

Generated with official Bubblewrap 1.25.0, package `com.vitrinecity.cultiva`. Signing material is outside this repository and must never be committed, published or included in outputs. The committed Digital Asset Links record contains only the public certificate fingerprint. Its current fingerprint is for the local signing key; the Google Play signing certificate must be added when available.

The Google account currently reaches the organization signup flow. Only the public developer name VitrineCity has been entered. The organizational D-U-N-S/profile verification, fee, app creation, Data Safety, rating, testing and publication remain subject to the actual Console workflow. No live Play Store URL is configured until publication is verified.

## Verification

Functional Node suites: `test-games-app-routes`, `test-games-app-pages`, `test-games-app-sw`, `test-games-install`, `test-cultiva-plants`, plus existing farm/member/privacy suites. Isolated release gate: `ops/verify-release.sh`.

Workstation browser suites live under `app/scripts/browser/` and are run separately using an installed browser and Playwright. They must not be mistaken for an Android device test or Play Store approval. Verify the built application response as well as source templates, because the image build injects public-site assets.
