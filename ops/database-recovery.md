# Database recovery

The daily systemd timer runs at 06:00 UTC (03:00 Sao Paulo), with up to five minutes of jitter. SQLite's online backup API creates a consistent copy without stopping the app. Integrity is checked before promotion; fourteen successful daily copies are retained under /data/recovery-backups in the app volume, directory mode 0700 and file mode 0600. Old manual copies are not pruned. Failures are recorded by systemd/journald.

Install the reviewed service/timer in /etc/systemd/system, run daemon-reload and enable --now the timer. Run the service once and check its Result plus journal output.

These are local database copies, not off-site protection or complete VPS backups. Uploaded files and deployment configuration require separate host backups. Before restoring production, stop writers, preserve the current database and WAL, validate the selected copy in an isolated directory, and verify a rollback path. Never overwrite a live SQLite database.
