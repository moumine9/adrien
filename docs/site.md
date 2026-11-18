# The project site

`pnpm build:site` builds the site into `site-dist/`: the landing page (`site/`), these docs rendered from the Markdown in
the repository (`scripts/site/docs.mjs`), and the live demo of the web visualizer, built with its mock data
(`packages/web`, `vite build --mode demo`). The `Pages` workflow (`.github/workflows/pages.yml`) runs it and deploys the
result on each push to `main` that changes the site, the docs, the README or the web app.

The repository owner enables Pages once: in the repository, open Settings, then Pages, and set Source to GitHub Actions.
Until that is set, the deploy job fails.
