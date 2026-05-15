Wrap up this session: commit any staged/unstaged changes, push to the current branch, then log the session to OpenBrain.

Follow these steps exactly:

1. **Debrief** — give the structured session summary:
   - Root cause / what was done
   - Key decisions or findings
   - Files changed
   - Result / test status

2. **Commit** — stage relevant files and commit with a clear message following the repo's conventional commit style. Co-author line required.

3. **Push** — `git push origin <current-branch>`

4. **OpenBrain log** — check for an existing entry within 7 days first:
   ```
   cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend" && pnpm brain -- knowledge list --project "Plug A Pro"
   ```
   If a related entry exists, update it (add a `## <date>` section). Otherwise create a new one:
   ```
   pnpm brain -- knowledge add --project "Plug A Pro" --domain "engineering" \
     --title "<type> — <summary> (YYYY-MM-DD)" \
     --tags "<relevant tags>" \
     --content "<structured log>"
   ```

Do all four steps without asking for confirmation.
