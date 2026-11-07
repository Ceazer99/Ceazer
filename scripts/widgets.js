  (() => {
    // ── Back to top ──────────────────────────────────────────────
    const btt = document.getElementById('backToTop');
    const threshold = 0.35; // show after 35% of page scrolled

    function updateBtt() {
      const scrolled = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      btt.classList.toggle('visible', scrolled > threshold);
    }
    window.addEventListener('scroll', updateBtt, { passive: true });

    btt.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior:
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
      });
    });

    // ── POPIA consent banner ─────────────────────────────────────
    const banner = document.getElementById('popiaBanner');
    const CONSENT_KEY = 'ceazers_popia_consent';

    function showBanner() {
      banner.classList.remove('hidden');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => banner.classList.add('visible'));
      });
    }
    // localStorage can throw (Safari private mode, blocked site data);
    // a throw here used to kill the banner buttons entirely.
    function readConsent() {
      try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
    }
    function writeConsent(value) {
      try { localStorage.setItem(CONSENT_KEY, value); } catch { /* ignore */ }
    }

    // The banner is a notice, not a consent gate: the site sets no optional
    // cookies, so there is nothing to accept or decline. "OK" just hides it.
    function dismissBanner() {
      banner.classList.remove('visible');
      banner.addEventListener('transitionend', () => banner.classList.add('hidden'), { once: true });
      // Fallback in case no transition runs (reduced motion, display:none)
      setTimeout(() => banner.classList.add('hidden'), 600);
      writeConsent('seen');
    }

    // Show banner if not dismissed before
    if (!readConsent()) {
      setTimeout(showBanner, 1200); // slight delay after page load
    }

    document.getElementById('popiaAccept')?.addEventListener('click', dismissBanner);

    // Banner + contact-form privacy links open the same Privacy Policy modal as
    // the footer link (core.js).
    ['privacyLinkBanner', 'privacyLinkForm'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', e => {
        e.preventDefault();
        document.getElementById('privacyLink')?.click();
      });
    });

    // ── Google Maps: load only when the visitor asks ─────────────
    // Embedding Google Maps lets Google set cookies, so it is not loaded until requested.
    const mapBox = document.getElementById('mapEmbed');
    document.getElementById('mapLoad')?.addEventListener('click', () => {
      const src = mapBox && mapBox.dataset.src;
      if (!src || !/^https:\/\/maps\.google\.com\//.test(src)) return;
      const frame = document.createElement('iframe');
      frame.src = src;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer-when-downgrade';
      frame.title = 'Ceazers 3D location - uMbilo, Durban, KZN';
      frame.allowFullscreen = true;
      mapBox.replaceChildren(frame);
    });
  })();
