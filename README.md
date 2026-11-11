# ATD Website

A local mirror of [atdumich.com](https://atdumich.com) (Alpha Theta Delta, University of Michigan), hosted on GitHub Pages.

## Commands

```bash
npm install      # once
npm start        # run the site at http://localhost:8000
npm run update   # re-download the latest version of atdumich.com into site/
```

After `npm run update`, commit and push. GitHub Pages redeploys automatically.

## Layout

- `site/`: the mirrored site (pages + all images, videos, fonts and scripts under `site/_assets/`)
- `tools/mirror.mjs`: downloads atdumich.com into `site/`
- `tools/build-pages.mjs`: prepares `site/` for GitHub Pages, which serves it from `/ATD_Website/` instead of the domain root
- `.github/workflows/pages.yml`: builds and deploys to GitHub Pages on every push to `main`
