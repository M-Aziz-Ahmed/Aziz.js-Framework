# Aziz.js project site

Static landing page for **Aziz.js Framework**, deployed with GitHub Pages.

## Publish it

1. Make the repository public.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push a change under `site/` (or run the **Deploy site** workflow manually).
4. The site is published at <https://m-aziz-ahmed.github.io/Aziz.js-Framework/>.

After it is live, update `homepage` in the root `package.json` to that URL so
npm and jsDelivr link to it, then publish a new npm version.

## Files

- `index.html` — landing page, Open Graph tags, JSON-LD (`SoftwareApplication` + `Person`)
- `styles.css` — site styles
- `assets/syed-muhammad-aziz-ahmed.jpg` — author portrait for JSON-LD and Open Graph (1200×1200)
- `assets/syed-muhammad-aziz-ahmed-600.jpg` — smaller portrait for the author card
- `robots.txt`, `sitemap.xml` — crawler hints for the canonical Pages URL
- `favicon.svg` — site icon
