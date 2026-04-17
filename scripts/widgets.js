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
    function dismissBanner(accepted) {
      banner.classList.remove('visible');
      banner.addEventListener('transitionend', () => banner.classList.add('hidden'), { once: true });
      localStorage.setItem(CONSENT_KEY, accepted ? 'accepted' : 'declined');
    }

    // Show banner if no stored consent
    if (!localStorage.getItem(CONSENT_KEY)) {
      setTimeout(showBanner, 1200); // slight delay after page load
    }

    document.getElementById('popiaAccept').addEventListener('click', () => dismissBanner(true));
    document.getElementById('popiaDecline').addEventListener('click', () => dismissBanner(false));

    // Hook privacy policy links to show a placeholder modal
    ['privacyLink','privacyLinkBanner'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', e => {
        e.preventDefault();
        alert('Privacy Policy\n\nCeazer 3D Engineering Solutions PTY LTD collects only the information you voluntarily provide via our contact form (name, email, message). This data is used solely to respond to your enquiry and is not shared with third parties. We do not use tracking cookies or analytics. In compliance with the Protection of Personal Information Act (POPIA), you may request access to or deletion of your data at any time by emailing siyabonga.masiza@ceazers3d.com.');
      });
    });
  })();
