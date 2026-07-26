# tech-log

Simple Astro site for documenting projects and technology you're learning. Each post is a markdown file.

## Getting started

```
npm install
npm run dev
```

Open http://localhost:4321

## Adding a new post

1. Copy `templates/post-template.md` into `src/content/posts/` and give it a descriptive filename (e.g. `my-new-project.md`).
2. Fill out the frontmatter (title, date, tags, excerpt, repo/demo).
3. Write the content below.
4. Push to `main` — the site builds and publishes automatically.

## Publishing on GitHub Pages

1. Push this repo to GitHub as `lvl21paladin/tech-log`.
2. In the repo: Settings → Pages → Build and deployment → Source → **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes automatically.

The site goes live at `https://lvl21paladin.github.io/tech-log/` a few minutes after push.

## Images

Put image files in `public/`, reference them in markdown with `![alt](/tech-log/image.png)` (remember the base prefix).
