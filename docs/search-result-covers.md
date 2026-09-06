# Search result covers and single external action

The search page displays static cover images when an existing search response
supplies a supported image. The cover itself is not clickable and never starts
a player. External results have one native link that opens a new tab with
`noopener noreferrer`; affiliate links retain `sponsored` and disclosure.
The allowlisted own-page reader remains available.

## Sources and limits

- `metasearch.js` carries SearXNG `thumbnail` or `img_src` as optional
  `thumbnailUrl`. The existing 120-second in-memory cache and upstream requests
  are unchanged. Duplicates may supply the first valid cover without changing
  the original result's title or ranking.
- Local product `imageUrl` and store `logoUrl` / `facadeUrl` fields are reused.
- Official product photos also use the owner-provided domain
  `adubonpkparaplantas.com.br`, restricted to dated WordPress raster uploads
  (`/wp-content/uploads/YYYY/MM/filename`) without query parameters. Other paths
  and lookalike hosts remain rejected.
- The pure shared `public/search-result-image.js` validates a small set of
  explicit CDN hosts/paths and own-origin raster images under `/assets` and
  `/uploads`. It rejects arbitrary URLs, credentials, unsafe schemes, ports on
  external hosts, and traversal. No arbitrary image proxy or page scraper exists.
- There is no new paid API, YouTube eligibility request, derived video thumbnail
  URL, automatic playback, or backend image download/storage.
- Missing, unsupported, failed, or tracking-sized images leave a text-only result.
  Coverage is therefore not guaranteed for every result or social network.
- Images load lazily with reserved aspect ratio and `referrerPolicy=no-referrer`.
  Direct CDN loading still exposes connection information such as the visitor's
  IP to that CDN. Thumbnail availability is not a license to redistribute an image.

SearXNG fields: https://docs.searxng.org/dev/result_types/main/mainresult.html

## Verification

Run from the repository root:

```sh
node app/scripts/test-search-result-image.mjs
node app/scripts/test-search-result-cover.mjs
node app/scripts/test-search-reader.mjs
node app/scripts/test-metasearch.mjs
node app/scripts/test-search-autocomplete.mjs
node app/scripts/test-public-cache.mjs
```

Browser checks should cover mobile and desktop, missing/broken images, local
photos, affiliate external results, exactly one external action, original tab
preservation, no iframe/player, own-reader sanitization, autocomplete and banners.
Block `/api/ads/serve` and paid destinations while testing to avoid artificial
advertising impressions or charges.

Scripts and styles already revalidate through HTTP and the service worker uses
network-first. An already-open tab retains its executed code until reloaded;
there is no forced reload that could discard a visitor's search.
