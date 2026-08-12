# Ceazers 3D - Engineering & Prototyping Studio

Marketing site for **Ceazers 3D Engineering Solutions (PTY) LTD**, a Durban-based
3D printing, CAD design, and rapid prototyping studio.

- **Production:** https://ceazers3d.com
- **Stack:** Plain HTML / CSS / JavaScript (no build step) + Vercel serverless functions
- **Hosting:** Vercel

---

## Quick start (local dev)

```bash
# 1. Clone
git clone https://github.com/<your-username>/ceazers-3d-website.git
cd ceazers-3d-website

# 2. Create your local env file (NEVER commit this file)
cp .env.example .env.local
# Then edit .env.local and paste in your real GEMINI_API_KEY

# 3. Serve the static site
python -m http.server 5500
# → open http://localhost:5500

# 4. (Optional) Run the full Vercel dev server with the /api routes
npm install -g vercel
vercel dev
# → open http://localhost:3000
```

The API routes (`/api/ai-quote`, `/api/generate-image`) only work with
`vercel dev` or a real Vercel deployment - not with the plain Python server.

---

## Project structure

```
.
├── index.html              # Single-page site (hero → services → … → contact)
├── sw.js                   # Service Worker (offline cache, asset pre-cache)
├── manifest.webmanifest    # PWA manifest
├── sitemap.xml, robots.txt # SEO
├── vercel.json             # Hosting + security headers + routing
├── package.json
│
├── styles/                 # Modular CSS (loaded in cascade order)
│   ├── base.css            #   Variables, reset, utilities, buttons
│   ├── nav.css             #   Top navigation + scroll progress bar
│   ├── hero.css            #   Hero section, 3D viewer panel, aurora bg
│   ├── sections.css        #   Services, projects, materials, about, contact
│   ├── footer.css
│   ├── estimator.css       #   Cost estimator wizard + AI quote panel
│   ├── faq.css             #   FAQ accordion
│   ├── widgets.css         #   WhatsApp FAB, back-to-top, POPIA banner
│   └── refinements.css     #   WCAG contrast + a11y overrides (loaded LAST)
│
├── scripts/                # Modular JS (all deferred)
│   ├── core.js             #   Navbar, scroll observers, counters, magnetic btns
│   ├── three-viewer.js     #   Three.js 3D hero viewer (ES module)
│   ├── animations.js       #   GSAP ScrollTrigger animations
│   ├── contact.js          #   Contact form validation
│   ├── estimator.js        #   Cost estimator wizard + AI quote fetch
│   ├── faq.js              #   FAQ accordion open/close
│   ├── sw-register.js      #   Service Worker registration
│   └── widgets.js          #   Back-to-top + POPIA cookie banner
│
├── api/                    # Vercel serverless functions (Node)
│   ├── ai-quote.js         #   POST → Gemini-powered quote estimate
│   ├── generate-image.js   #   POST → Gemini image generation
│   └── _lib/
│       └── guard.js        #   Shared CORS + rate-limit + input sanitiser
│                           #   (underscore prefix = not routed publicly)
│
├── images/                 # Hero, services, materials, portfolio WebPs
└── icons/                  # PWA icons (various sizes)
```

**CSS cascade order matters** - the `<link>` tags in `index.html` load the
stylesheets in the order listed above. `refinements.css` must stay last so
its accessibility / contrast overrides beat the base component styles.

---

## Environment variables

| Name             | Where to set it                     | Used by           |
| ---------------- | ----------------------------------- | ----------------- |
| `GEMINI_API_KEY` | `.env.local` (dev), Vercel dashboard (prod) | `api/*.js`        |

Get a Gemini key free at https://aistudio.google.com/app/apikey.
Rotate immediately if one is ever leaked into git history.

---

## Security posture

- `.env` / `.env.local` git-ignored; only `.env.example` (safe template) is committed.
- `/api/*` endpoints have origin-restricted CORS (not wildcard).
- Per-IP rate limits on both API endpoints (8/min quote, 4/min image).
- Input sanitisation + length caps on user-supplied prompt fields.
- `vercel.json` sets Content-Security-Policy, HSTS, X-Frame-Options,
  Referrer-Policy, Permissions-Policy on all HTML responses.
- Static assets get 1-year immutable caching; `sw.js` gets `no-cache` so
  Service Worker updates propagate immediately.

Verify headers after deploy: https://securityheaders.com/?q=ceazers3d.com

---

## Deploying

This repo is connected to Vercel. Anything pushed to `main` auto-deploys
to production. Branch pushes get a preview URL automatically.

```bash
# Normal change flow
git checkout -b descriptive-branch-name
# ...edit, test at http://localhost:5500...
git add .
git commit -m "short, clear description of the change"
git push -u origin descriptive-branch-name
# → open a Pull Request on GitHub
# → Vercel auto-builds a preview URL
# → smoke-test on the preview URL
# → merge PR → production deploys
```

**Never push directly to `main`** once the site is live. Always branch + PR.

---

## Common tasks

```bash
# See what you've changed
git status
git diff

# Undo all uncommitted changes (DESTRUCTIVE - can't be undone)
git restore .

# Roll back one file to how it was 3 commits ago
git checkout HEAD~3 -- path/to/file.css

# See deploy history
git log --oneline
```

---

## Contact

Siyabonga Masiza - masizaonam99@gmail.com
Ceazers 3D Engineering Solutions (PTY) LTD, Durban, KZN
