Wrap up this session: commit any staged/unstaged changes, push to the current branch, then log the session to OpenBrain.

Follow these steps exactly:

1. **Debrief** — give the structured session summary:
   - Root cause / what was done
   - Key decisions or findings
   - Files changed
   - Result / test status

2. **Commit** — stage relevant files and commit with a clear message following the repo's conventional commit style. Co-author line required.
   - Before staging, review `git status` and the diff and exclude anything that should not be committed (`.env*`, credentials, secrets, large binaries, unrelated working-tree changes). Never `git add -A` blindly.

3. **Push** — **ask the user for explicit yes/no confirmation before pushing.** Show the exact branch and commit that will be pushed, then wait for a clear "yes". Only on confirmation run `git push origin <current-branch>`. Never force-push to `main`/`master`. If the user declines, stop after the commit.

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

Steps 1, 2, and 4 may proceed without interruption. Step 3 (push) **always requires an explicit yes/no confirmation** from the user — never push automatically.
