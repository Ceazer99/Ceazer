    'use strict';

    /* ── Navbar: transparent → solid on scroll ─────────────────── */
    const navbar = document.getElementById('navbar');
    function updateNavbar() {
      navbar.classList.toggle('scrolled', window.scrollY > 50);
    }
    window.addEventListener('scroll', updateNavbar, { passive: true });
    updateNavbar(); // run once on load

    /* ── Active nav link on scroll ──────────────────────────────── */
    const sections   = document.querySelectorAll('section[id]');
    const navAnchors = document.querySelectorAll('.nav-links a');

    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navAnchors.forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });

    sections.forEach(s => sectionObserver.observe(s));

    /* ── Mobile hamburger ───────────────────────────────────────── */
    const hamburger  = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');

    function closeMobileMenu() {
      hamburger.classList.remove('open');
      mobileMenu.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    }

    hamburger.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.querySelectorAll('.mobile-link, .mobile-menu .btn')
      .forEach(el => el.addEventListener('click', closeMobileMenu));

    document.addEventListener('click', e => {
      if (!mobileMenu.contains(e.target) && !hamburger.contains(e.target)) {
        closeMobileMenu();
      }
    });

    /* ── Smooth scroll for all internal anchor links ────────────── */
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          e.preventDefault();
          closeMobileMenu();
          const top = target.getBoundingClientRect().top + window.scrollY - 80;
          window.scrollTo({ top, behavior: 'smooth' });
        }
      });
    });

    /* ── Back to top ────────────────────────────────────────────── */
    const backToTop = document.getElementById('back-to-top');

    window.addEventListener('scroll', () => {
      backToTop.classList.toggle('visible', window.scrollY > 500);
    }, { passive: true });

    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    /* ── Scroll-triggered fade-up animations ────────────────────── */
    const fadeEls = document.querySelectorAll('.fade-up');
    const fadeObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          fadeObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.10, rootMargin: '0px 0px -30px 0px' });

    fadeEls.forEach(el => fadeObserver.observe(el));

    /* ── Form validation & submission ───────────────────────────── */
    const quoteForm  = document.getElementById('quoteForm');
    const formSuccess = document.getElementById('formSuccess');
    const submitBtn  = document.getElementById('submitBtn');

    // Field rules: [fieldId, errorId, validator fn]
    const fields = [
      ['firstName',  'err-firstName',  v => v.trim().length > 0],
      ['lastName',   'err-lastName',   v => v.trim().length > 0],
      ['email',      'err-email',      v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())],
      ['clientType', 'err-clientType', v => v !== ''],
      ['service',    'err-service',    v => v !== ''],
      ['message',    'err-message',    v => v.trim().length > 10],
    ];

    function validateField(id, errId, validator) {
      const el  = document.getElementById(id);
      const err = document.getElementById(errId);
      const ok  = validator(el.value);
      el.classList.toggle('error', !ok);
      err.classList.toggle('visible', !ok);
      return ok;
    }

    // Clear error state on interaction
    fields.forEach(([id, errId, validator]) => {
      const el = document.getElementById(id);
      el.addEventListener('input',  () => validateField(id, errId, validator));
      el.addEventListener('change', () => validateField(id, errId, validator));
    });

    quoteForm.addEventListener('submit', function (e) {
      e.preventDefault();

      // Validate all fields
      const allValid = fields.map(([id, errId, fn]) =>
        validateField(id, errId, fn)
      ).every(Boolean);

      if (!allValid) {
        // Scroll to first error
        const firstError = quoteForm.querySelector('.error');
        if (firstError) {
          const top = firstError.getBoundingClientRect().top + window.scrollY - 120;
          window.scrollTo({ top, behavior: 'smooth' });
        }
        return;
      }

      // Disable button + show loading state
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          style="animation: spin 0.7s linear infinite" aria-hidden="true">
          <path d="M21 12a9 9 0 11-3.1-6.8"/>
        </svg>
        Sending…
      `;

      // Send form data to Web3Forms → your email
      const formData = new FormData(quoteForm);
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: formData,
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            quoteForm.style.display   = 'none';
            formSuccess.style.display = 'block';
          } else {
            throw new Error(data.message || 'Submission failed');
          }
        })
        .catch(err => {
          console.error('Form error:', err);
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            Send Enquiry
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          `;
          // Show inline error message
          let errMsg = quoteForm.querySelector('.form-submit-error');
          if (!errMsg) {
            errMsg = document.createElement('p');
            errMsg.className = 'form-submit-error';
            errMsg.style.cssText = 'color:#EF4444;font-size:0.875rem;text-align:center;margin-top:12px;';
            quoteForm.querySelector('.form-submit').appendChild(errMsg);
          }
          errMsg.textContent = 'Something went wrong. Please try again or email us directly at siyabonga.masiza@ceazers3d.com';
        });
    });

    /* ── Spinner keyframe (injected once) ───────────────────────── */
    const spinStyle = document.createElement('style');
    spinStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(spinStyle);

    /* ══════════════════════════════════════════════════════════════
       STATIC IMAGE LOADER
       Fades in images once loaded; hides placeholder when image is present.
       Drop files into the /images folder to activate each slot.
    ══════════════════════════════════════════════════════════════ */

    document.querySelectorAll('img.site-img').forEach(img => {
      if (img.complete && img.naturalWidth > 0) {
        img.classList.add('loaded');
        hidePlaceholder(img);
      } else {
        img.addEventListener('load', () => {
          img.classList.add('loaded');
          hidePlaceholder(img);
        });
      }
    });

    function hidePlaceholder(img) {
      // Hide sibling placeholder elements when a real image loads
      const parent = img.parentElement;
      if (!parent) return;
      const placeholder = parent.querySelector('.project-placeholder, .hero-visual-placeholder, .about-photo-placeholder');
      if (placeholder) placeholder.style.display = 'none';
    }

    /* ══════════════════════════════════════════════════════════════
       3D TILT CARDS, mouse-tracking perspective hover
    ══════════════════════════════════════════════════════════════ */
    if (window.innerWidth > 768) {
      document.querySelectorAll('.tilt-card').forEach(card => {
        card.addEventListener('mousemove', e => {
          const rect = card.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          const rotateX = (0.5 - y) * 14;   // max 7deg
          const rotateY = (x - 0.5) * 14;
          card.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
        });
        card.addEventListener('mouseleave', () => {
          card.style.transform = 'perspective(700px) rotateX(0) rotateY(0) translateY(0)';
        });
      });
    }

    /* ══════════════════════════════════════════════════════════════
       PROCESS STEPS, hover-to-focus pop effect
    ══════════════════════════════════════════════════════════════ */
    if (window.innerWidth > 768) {
      const stepsContainer = document.querySelector('.process-steps');
      const steps = document.querySelectorAll('.process-step');
      if (stepsContainer && steps.length) {
        steps.forEach(step => {
          step.addEventListener('mouseenter', () => {
            stepsContainer.classList.add('has-hover');
            steps.forEach(s => s.classList.remove('is-focused'));
            step.classList.add('is-focused');
          });
          step.addEventListener('mouseleave', () => {
            step.classList.remove('is-focused');
            stepsContainer.classList.remove('has-hover');
          });
        });
      }
    }

    /* ══════════════════════════════════════════════════════════════
       PARALLAX SCROLL, depth layers move at different speeds
    ══════════════════════════════════════════════════════════════ */
    const parallaxElements = [
      { el: document.querySelector('.hero-glow-1'), speed: 0.04 },
      { el: document.querySelector('.hero-glow-2'), speed: -0.03 },
      { el: document.querySelector('.hero-shapes'), speed: 0.02 },
      { el: document.querySelector('.wireframe-cube'), speed: 0.05 },
    ].filter(p => p.el);

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          parallaxElements.forEach(({ el, speed }) => {
            el.style.transform = `translateY(${scrollY * speed}px)`;
          });
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });

    /* ══════════════════════════════════════════════════════════════
       HERO MOUSE PARALLAX, shapes follow cursor subtly
    ══════════════════════════════════════════════════════════════ */
    const heroSection = document.getElementById('hero');
    if (heroSection && window.innerWidth > 768) {
      const shapesContainer = heroSection.querySelector('.hero-shapes');
      const cube = heroSection.querySelector('.wireframe-cube');
      heroSection.addEventListener('mousemove', e => {
        const rect = heroSection.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        if (shapesContainer) {
          shapesContainer.style.transform = `translate(${x * 20}px, ${y * 15}px)`;
        }
        if (cube) {
          cube.style.transform = `translate(${x * -30}px, ${y * -20}px) rotateX(${-20 + y * 10}deg) rotateY(${x * 30}deg)`;
        }
      });
    }

    /* ══════════════════════════════════════════════════════════════
       REVEAL-3D, IntersectionObserver for 3D entrance
    ══════════════════════════════════════════════════════════════ */
    const reveal3dObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          reveal3dObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.reveal-3d').forEach(el => reveal3dObserver.observe(el));

    /* ══════════════════════════════════════════════════════════════
       SCROLL PROGRESS BAR
    ══════════════════════════════════════════════════════════════ */
    const scrollProgress = document.getElementById('scrollProgress');
    function updateScrollProgress() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      scrollProgress.style.width = progress + '%';
    }
    window.addEventListener('scroll', updateScrollProgress, { passive: true });
    updateScrollProgress();

    /* ══════════════════════════════════════════════════════════════
       ANIMATED STAT COUNTERS, count up on scroll into view
    ══════════════════════════════════════════════════════════════ */
    function animateCounter(el) {
      const target = parseInt(el.dataset.target, 10);
      const suffix = el.dataset.suffix || '';
      const duration = 2000;
      const startTime = performance.now();

      function easeOutExpo(t) {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      }

      function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeOutExpo(progress);
        const current = Math.round(easedProgress * target);
        el.textContent = current + suffix;
        if (progress < 1) {
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
    }

    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const counters = entry.target.querySelectorAll('.count-up');
          counters.forEach((counter, i) => {
            setTimeout(() => animateCounter(counter), i * 150);
          });
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });

    // Observe parent containers of counters
    document.querySelectorAll('.hero-stats, .why-right').forEach(el => {
      counterObserver.observe(el);
    });

    /* ══════════════════════════════════════════════════════════════
       LAYER-BY-LAYER PRINT REVEAL — nozzle sweep on section enter
    ══════════════════════════════════════════════════════════════ */
    const printRevealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('printing');
          printRevealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    document.querySelectorAll('.print-reveal').forEach(el => {
      printRevealObserver.observe(el);
    });

    /* ══════════════════════════════════════════════════════════════
       EXTRUDER HEAD SECTION DIVIDERS — animate on scroll into view
    ══════════════════════════════════════════════════════════════ */
    const extruderObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          extruderObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    document.querySelectorAll('.extruder-divider').forEach(el => {
      extruderObserver.observe(el);
    });

    /* ══════════════════════════════════════════════════════════════
       FILAMENT SPOOL — scroll-connected rotation
    ══════════════════════════════════════════════════════════════ */
    const spoolRotate = document.querySelector('.spool-rotate');
    if (spoolRotate && window.innerWidth > 768) {
      window.addEventListener('scroll', () => {
        const rotation = window.scrollY * 0.5;
        spoolRotate.style.transform = `rotate(${rotation}deg)`;
        spoolRotate.style.transformOrigin = '80px 80px';
      }, { passive: true });
    }

    /* ══════════════════════════════════════════════════════════════
       FILAMENT PATH — SVG stroke draws as you scroll
    ══════════════════════════════════════════════════════════════ */
    const filamentLine = document.getElementById('filamentLine');
    if (filamentLine && window.innerWidth > 768) {
      const pathLength = filamentLine.getTotalLength();
      filamentLine.style.strokeDasharray = pathLength;
      filamentLine.style.strokeDashoffset = pathLength;

      function updateFilamentPath() {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? scrollTop / docHeight : 0;
        filamentLine.style.strokeDashoffset = pathLength * (1 - progress);
      }

      window.addEventListener('scroll', updateFilamentPath, { passive: true });
      updateFilamentPath();
    }

    /* ══════════════════════════════════════════════════════════════
       LAYER COUNTER — fixed corner printer LCD, updates on scroll
    ══════════════════════════════════════════════════════════════ */
    const layerCounter = document.getElementById('layerCounter');
    const lcLayer = document.getElementById('lcLayer');
    const lcPercent = document.getElementById('lcPercent');
    const lcBar = document.getElementById('lcBar');
    const totalLayers = 312;

    const lcStatus = document.querySelector('.layer-counter .lc-status');

    if (layerCounter && window.innerWidth > 768) {
      function updateLayerCounter() {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? scrollTop / docHeight : 0;
        const currentLayer = Math.max(1, Math.round(progress * totalLayers));
        const pct = Math.round(progress * 100);

        lcLayer.textContent = String(currentLayer).padStart(3, '0') + '/' + totalLayers;
        lcPercent.textContent = pct + '%';
        lcBar.style.width = pct + '%';

        // Show counter after scrolling a bit
        layerCounter.classList.toggle('visible', scrollTop > 100);

        // Show complete state when at bottom
        if (progress >= 0.98) {
          lcStatus.textContent = '✓ PRINT COMPLETE';
          lcStatus.style.color = '#22C55E';
          lcStatus.style.animation = 'none';
          layerCounter.classList.add('complete');
        } else {
          lcStatus.textContent = '● PRINTING';
          lcStatus.style.color = '';
          lcStatus.style.animation = '';
          layerCounter.classList.remove('complete');
        }
      }

      window.addEventListener('scroll', updateLayerCounter, { passive: true });
      updateLayerCounter();
    }

    /* ══════════════════════════════════════════════════════════════
       PRIVACY POLICY & TERMS OF SERVICE MODALS
    ══════════════════════════════════════════════════════════════ */
    function openModal(id) {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.modal-close').focus();
    }

    function closeModal(overlay) {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    document.getElementById('privacyLink').addEventListener('click', e => {
      e.preventDefault();
      openModal('privacyModal');
    });

    document.getElementById('termsLink').addEventListener('click', e => {
      e.preventDefault();
      openModal('termsModal');
    });

    // Close on × button click
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal(btn.closest('.modal-overlay'));
      });
    });

    // Close on backdrop click (clicking outside the modal-box)
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) closeModal(overlay);
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(closeModal);
      }
    });

