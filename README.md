# ATD Website

A mirror of [atdumich.com](https://atdumich.com) (Alpha Theta Delta, University of Michigan), hosted on Vercel.

## Commands

```bash
npm install      # once
npm start        # run the site at http://localhost:8000
npm run update   # re-download the latest version of atdumich.com into site/
```

After `npm run update`, commit and push. Vercel redeploys automatically.

## Layout

- `site/`: the mirrored site (pages + all images, videos, fonts and scripts under `site/_assets/`)
- `tools/mirror.mjs`: downloads atdumich.com into `site/`
- `vercel.json`: tells Vercel to serve `site/` as-is (no build step) with clean URLs (`/board` → `board.html`)
