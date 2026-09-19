# Native-audio extension to the reconciled LIA release

The dedicated PR #211 extends the deployed image-routing release, not main.
The package lives in `ops/lia-native-audio/`. Its builder enforces full source and
result SHA-256 hashes for three existing files and one new policy module.
The application source tree in Git is not overwritten by the builder: the payload
is materialized only in the isolated build context. The active image supplies all
other application files and installed dependencies.

## Invariants

- Preserve the image alias routing fix, DeepSeek text path, Kling image path,
  Browser/Media workers, init, mounts, network, private credentials and price rules.
- Only add the explicit `kling.nativeAudio720` configuration member. Do not replace
  FX, prepaid balances, the entire paid config, or provider keys.
- Native audio uses the owner's 2026-09-19 API list-price snapshot for Kling 3.0
  720p without voice control: USD 0.126/second. No Turbo/Omni substitution.
- Silent legacy request bodies/hashes remain unchanged. Native selection is part
  of the authorized paid-body hash. Every new request needs a quoted confirmation.
- Validate MP4 audio with local bounded ffprobe/ffmpeg. No missing/silent stream is
  promoted to successful audio delivery. Actual provider consumption is not
  replaced with fictitious zero cost. Never retry a paid generation automatically.
- No Portuguese speech, intelligibility or lip-sync guarantee; no automatic rewrite
  of previous videos; no addition of general vision or open-ended browser search.

## Validation and deployment

`LIA native audio validation` runs 23 release-contract tests and a real Docker
update/rollback exercise with locked app dependencies, synthetic SQLite data,
Express HTTP and FFmpeg fixtures. The synthetic exercise tests the explicit
rollback and a post-swap failure, preserving writes made after deployment.
It never mounts production data, loads actual credentials, or sends provider calls.
The existing Preserve Kling, deploy package, init migration and image routing
workflows remain part of the required approval set alongside Neural and release CI.

The production updater reuses the exact v92 recovery helper from the successful
2026-09-19 12:40:12 UTC release, then checks PR #211 and Sonar for the exact commit.
It tests the candidate on the installed image before a normal app-only stop.
It does not accept the legacy forced-stop exception. Existing online backups are
verified; fresh SQLite snapshots are made around the stop. Rollback restores code
and configuration only: it never overwrites the live database with an older copy.

Default mode is `plano`, with no deployment. Applying requires `--confirmar-troca`.
After success, a real small audio-video task still requires the owner's approval
of its quote. CI success is not a claim of live provider generation or VPS deploy.
