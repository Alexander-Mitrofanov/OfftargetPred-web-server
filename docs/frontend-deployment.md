# Automatic frontend deployment

The live frontend is
[GitHub Pages](https://alexander-mitrofanov.github.io/OfftargetPred-web-server/).
The existing API stays at `https://offtargetpred-web.tail58d78e.ts.net`.

## How updates reach the website

Push or merge frontend changes to `main` in
`Alexander-Mitrofanov/OfftargetPred-web-server`.
[Deploy GitHub Pages](https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server/actions/workflows/pages.yml)
automatically installs locked dependencies, runs the frontend tests, checks
TypeScript, builds the Vite application and publishes `frontend/dist/`.
No separate deployment command is needed.

The workflow watches `frontend/**`, `tests/frontend/**`, its own workflow file,
and the citation, licence, notices and diagnostics files used by the frontend.
Backend-only or unrelated documentation changes do not republish the site.
Feature-branch pushes do not deploy; merge to `main` when ready.

An invalid API origin, failing frontend test or failed build prevents deployment,
leaving the previously published site in place. Deployments run one at a time;
an active publication finishes before the newest queued update starts.
Allow the Actions run and Pages cache propagation to finish, then refresh the
browser to load the update. Already-open pages do not hot-reload automatically.

## Existing GitHub configuration

These settings were verified on 22 September 2026:

- **Settings → Pages → Source:** GitHub Actions, with HTTPS enforced.
- **Settings → Secrets and variables → Actions → Variables:**
  `OFFTARGET_API_ORIGIN=https://offtargetpred-web.tail58d78e.ts.net`.
- **Settings → Environments → github-pages:** branch deployment protection.
  The workflow also restricts deployment to `main`, including manual runs.

The API origin is public frontend configuration, not a secret. Keep it as an
HTTPS origin without `/api/v1` or a trailing slash. Missing or malformed values
produce an explicit workflow error. Vite's base remains
`/OfftargetPred-web-server/`.

Only the deployment job receives `pages: write` and `id-token: write`; the build
has read-only repository access. The workflow uses GitHub-hosted runners and
GitHub's built-in token. It has no SSH key, server installation command,
backend deployment, Nginx change, or Tailscale authentication/configuration step.
The separate Application checks workflow may test the backend but does not
deploy it.

## Verify, retry and roll back

Check the workflow run linked above. After it succeeds, open
[deployment.json](https://alexander-mitrofanov.github.io/OfftargetPred-web-server/deployment.json)
to see the published Git commit, unchanged API origin and deployment run URL.
The run summary also links the website and this metadata.

For an explicit rebuild, choose **Actions → Deploy GitHub Pages → Run workflow**
with branch **main**. This is also needed after changing a repository variable,
because changing variables does not generate a push event.

To roll back, revert the unwanted frontend changes on `main` and push that
commit. A failed build needs a fix and a new push (or a rerun for a transient
failure). Do not run the backend service installer or change Funnel to update
the frontend. Local edits only become public after they are committed and pushed.

## Research and choice

GitHub documents [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
with an uploaded static artifact and a protected deployment job. Vite documents
[the same approach for GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages),
including the repository-specific base path. This project already uses that
architecture and had successful automatic deployments; extending its existing
workflow avoids adding a server-side webhook, deployment agent or new host.
