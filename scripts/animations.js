  window.addEventListener('load', function () {
    if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── 1. SCROLL PROGRESS BAR - handled in core.js ───────────── */

    /* ── 2. HERO PARALLAX ────────────────────────────────────────── */
    if (!reducedMotion) {
      gsap.to('.hero-glow-1', {
        y: -80, ease: 'none',
        scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: 1.2 }
      });
      gsap.to('.hero-glow-2', {
        y: -50, ease: 'none',
        scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: 0.9 }
      });
      gsap.to('.hero-left', {
        y: 40, ease: 'none',
        scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: 0.7 }
      });
    }

    /* ── 3. SECTION TITLE CHARACTER STAGGER ─────────────────────── */
    function splitAndReveal(selector) {
      document.querySelectorAll(selector).forEach(el => {
        if (el.dataset.gsapSplit) return; // already done
        el.dataset.gsapSplit = '1';
        // Wrap each char in a span. Built with DOM nodes (not textContent →
        // innerHTML) so <br> line breaks survive and "&" / "<" stay literal.
        const frag = document.createDocumentFragment();
        el.childNodes.forEach(node => {
          if (node.nodeType !== Node.TEXT_NODE) {
            frag.appendChild(node.cloneNode(true)); // keep <br>, <em>, etc.
            return;
          }
          for (const ch of node.textContent) {
            const span = document.createElement('span');
            span.className = 'char';
            span.style.display = 'inline-block';
            if (ch === ' ') { span.style.width = '0.3em'; span.textContent = ' '; }
            else span.textContent = ch;
            frag.appendChild(span);
          }
        });
        el.replaceChildren(frag);

        gsap.from(el.querySelectorAll('.char'), {
          opacity: 0,
          y: reducedMotion ? 0 : 22,
          rotateX: reducedMotion ? 0 : -35,
          stagger: { each: 0.025, from: 'start' },
          ease: 'power3.out',
          duration: 0.65,
          scrollTrigger: {
            trigger: el,
            start: 'top 88%',
            toggleActions: 'play none none none',
            once: true
          }
        });
      });
    }
    splitAndReveal('.section-title');

    /* ── 4. SCROLLTRIGGER BATCH - service cards ──────────────────── */
    ScrollTrigger.batch('.service-card', {
      onEnter: batch => gsap.fromTo(batch,
        { opacity: 0, y: reducedMotion ? 0 : 40 },
        { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out', stagger: 0.1, overwrite: 'auto' }
      ),
      start: 'top 85%',
      once: true
    });

    /* ── 5. SCROLLTRIGGER BATCH - project cards ──────────────────── */
    ScrollTrigger.batch('.project-card', {
      onEnter: batch => gsap.fromTo(batch,
        { opacity: 0, y: reducedMotion ? 0 : 50, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.75, ease: 'power2.out', stagger: 0.12, overwrite: 'auto' }
      ),
      start: 'top 85%',
      once: true
    });

    /* ── 6. SCROLLTRIGGER BATCH - material cards ─────────────────── */
    ScrollTrigger.batch('.material-card', {
      onEnter: batch => gsap.fromTo(batch,
        { opacity: 0, x: reducedMotion ? 0 : -30 },
        { opacity: 1, x: 0, duration: 0.65, ease: 'power2.out', stagger: 0.08, overwrite: 'auto' }
      ),
      start: 'top 88%',
      once: true
    });

    /* ── 7. TOOLS STRIP - staggered entrance ─────────────────────── */
    ScrollTrigger.batch('.tool-card', {
      onEnter: batch => {
        batch.forEach((card, i) => {
          const delay = parseInt(card.style.getPropertyValue('--tool-delay')) || i * 80;
          gsap.to(card, {
            opacity: 1, y: 0, duration: 0.55, ease: 'power2.out',
            delay: delay / 1000, overwrite: 'auto'
          });
          card.classList.add('is-visible');
        });
      },
      start: 'top 88%',
      once: true
    });

    /* ── 8. WHY-SECTION STATS - scrubbed scale-up ────────────────── */
    if (!reducedMotion) {
      gsap.from('.why-stat-num', {
        scale: 0.7, opacity: 0,
        duration: 0.7, ease: 'back.out(1.7)', stagger: 0.1,
        scrollTrigger: { trigger: '#why', start: 'top 75%', once: true }
      });
    }

    /* ── 9. SECTION DIVIDERS - fill from left ────────────────────── */
    document.querySelectorAll('.extruder-divider .printed-line').forEach(line => {
      gsap.fromTo(line,
        { scaleX: 0 },
        {
          scaleX: 1, duration: 1.2, ease: 'power2.out',
          scrollTrigger: { trigger: line.closest('.extruder-divider'), start: 'top 85%', once: true }
        }
      );
    });

    /* ── 10. ABOUT SECTION IMAGE - parallax drift ────────────────── */
    if (!reducedMotion) {
      gsap.to('.about-img', {
        y: -30, ease: 'none',
        scrollTrigger: { trigger: '#about', start: 'top bottom', end: 'bottom top', scrub: 1 }
      });
    }

  });
