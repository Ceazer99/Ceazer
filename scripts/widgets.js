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

    function dismissBanner(accepted) {
      banner.classList.remove('visible');
      banner.addEventListener('transitionend', () => banner.classList.add('hidden'), { once: true });
      // Fallback in case no transition runs (reduced motion, display:none)
      setTimeout(() => banner.classList.add('hidden'), 600);
      writeConsent(accepted ? 'accepted' : 'declined');
    }

    // Show banner if no stored consent
    if (!readConsent()) {
      setTimeout(showBanner, 1200); // slight delay after page load
    }

    document.getElementById('popiaAccept').addEventListener('click', () => dismissBanner(true));
    document.getElementById('popiaDecline').addEventListener('click', () => dismissBanner(false));

    // Banner's privacy link opens the same Privacy Policy modal as the footer
    // link (core.js). It previously fired a browser alert() on top of the modal.
    const bannerPrivacy = document.getElementById('privacyLinkBanner');
    if (bannerPrivacy) bannerPrivacy.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('privacyLink')?.click();
    });
  })();
