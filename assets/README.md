# Brand assets

- `icon.svg`: the mark, with a transparent background. Its ink switches to light in a dark colour scheme. The web app's
  favicon (`packages/web/public/favicon.svg`) is a copy of it, and the navbar draws the same shapes in
  `packages/web/src/components/brand-mark.tsx`.
- `icon-512.png`: the mark on a cream tile, for places that do not follow the colour scheme (the README).
- `social-preview.png`: 1280 by 640, for GitHub's social preview. Upload it by hand in the repository settings.

The two PNGs come from `icon-512.svg` and `social-preview.svg`:

```sh
chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1280,640 --screenshot=social-preview.png file://$PWD/social-preview.svg
```

The social preview text uses Arial Black and Helvetica Neue, so render it on a machine that has them.
