# mermaid2anki

Mermaid to Anki pipeline using SVG embedding.

## Deploying as a GitHub Pages project site under pyamzi.com/mermaid2anki

This repository can be published as a GitHub Pages *project site* and served under the path `https://pyamzi.com/mermaid2anki` while being hosted from `https://pyamzi.github.io/mermaid2anki`.

Follow these steps:

1. Create a repository on GitHub called `mermaid2anki` under the `pyamzi` account and push this project to that repo.

2. In the repository settings on GitHub, enable **Pages**:

   - Under "Source", choose the branch to publish from (commonly `main` or `gh-pages`) and set the folder to `/ (root)`.
   - Save. GitHub will publish the site at `https://pyamzi.github.io/mermaid2anki`.

3. Configure the custom path `https://pyamzi.com/mermaid2anki`:

   - Option A — Reverse proxy / path-based routing (recommended if you control the `pyamzi.com` webserver):

     - Configure your webserver for `pyamzi.com` (Nginx, Apache, etc.) to proxy requests to `/mermaid2anki` to `https://pyamzi.github.io/mermaid2anki`.
     - This keeps the published site on GitHub Pages but serves it under your custom domain path.

   - Option B — CNAME to custom domain (works for root or subdomain, not sub-path):

     - GitHub Pages supports custom domains at the domain or subdomain level (e.g., `mermaid2anki.pyamzi.com`), but it does not natively support serving a project site under a path like `/mermaid2anki` on `pyamzi.com`.
     - If you want `mermaid2anki.pyamzi.com`, create a `CNAME` file with `mermaid2anki.pyamzi.com` and configure DNS accordingly.

Notes:

If you need the site specifically at `pyamzi.com/mermaid2anki` (path-based), the simplest approach is to configure your main `pyamzi.com` server to proxy that path to the GitHub Pages project URL. This keeps GitHub Pages hosting and gives you the exact path.

If you prefer a standalone subdomain (e.g., `mermaid2anki.pyamzi.com`), use GitHub Pages' custom domain feature directly.

Example Nginx proxy snippet (replace with your server's config):

```nginx
location /mermaid2anki/ {
  proxy_pass https://pyamzi.github.io/mermaid2anki/;
  proxy_set_header Host pyamzi.github.io;
}
```

Alternatively, Netlify and other hosts can fetch from your repository and publish under a custom path or subdomain; these services often provide easier custom-domain configuration.

If you want, I can add a small `deploy` section with a GitHub Actions workflow to automatically build (if needed) and push to `gh-pages` branch.
