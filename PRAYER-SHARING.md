# Daily prayer media and distribution

Owner request, 2026-09-11: one prayer daily at 07:00 America/Sao_Paulo, a 30-second vertical video and a TikTok version at least 60 seconds. Start 2026-09-12; the first edition contains real 30/61-second H.264/AAC files. Existing editorial calendar remains the source of prayers.

`/admin-oracoes.html` shows selected destinations, prepared media, receipt counts, outstanding connections and pause/resume. `GET /api/admin/prayer-sharing` is admin-only. Public dated media is exposed through narrowly validated `/prayer-media/:day/:format.mp4`, with native browser range support; private narration/receipts are not served.

The SQL setting is disabled by default. Activation requires the authorized snapshot of named WhatsApp groups and the existing Instagram target `@agrotecniica` (account 7, Campo & Conhecimento). Preserve prior group exclusions, especially Receitas 06. Do not automatically enroll new groups. Each send rechecks live membership and posting permission, current settings and global pause. Delivery starts at 07:00, staggered through the existing 3-per-tick worker, and expires at 07:45. No late backfill. Stable date/group IDs, atomic claims and provider receipts prevent duplicate retries after uncertain submissions.

The generator prepares one edition ahead. Two narration/transcription jobs per day use the existing OpenAI configuration; durable intent files precede chargeable requests, and interrupted/uncertain jobs require review. FFmpeg renders 720×1280 portrait, 30 fps, H.264 yuv420p with AAC, subtitle timing follows the recorded voice, and output duration is checked. Existing ready media is immutable by default. `font-dejavu` is included in the image. AI art and voice are disclosed in videos/captions. This is motion composition of the existing artwork, not a claim of newly filmed footage.

Instagram uses the previously verified Meta adapter, generalized to dated campaigns, with protected persistent receipts and final pause/date checks before every POST. The 07:00 worker prepares/polls/publishes and then verifies the provider's media/owner/caption/permalink. No publication is reported before that receipt.

YouTube currently has only metrics API key/channel ID, without upload OAuth. TikTok authorization was renewed and creator info checked, but app configuration remains sandbox and the required publishing/visibility flow is outstanding. Facebook group distribution is a manual/native scheduling package; there is no configured supported Groups publisher. These channels are explicitly shown as pending/manual, not active automatic sends. No substitution of Facebook pages for requested groups.

The dedicated prayer group is permitted only for the `prayer-v1:` campaign, while the same group's commercial exclusion remains in effect. The shared worker checks exclusions per schedule, so the prayer exception cannot allow promotions. Receitas 06 remains excluded from automation.

Validation: `node --test scripts/test-prayer-daily.mjs scripts/test-prayer-page.mjs scripts/test-prayer-media.mjs scripts/test-prayer-sharing.mjs scripts/test-whatsapp-schedule-worker.mjs`. Tests must use an isolated SQLite database and fake network; never send test messages to real groups.
