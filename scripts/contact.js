  (function() {
    // Only on non-touch, non-reduced-motion devices
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const STRENGTH = 0.38; // How strong the magnetic pull is (0–1)

    document.querySelectorAll('.btn--primary, .btn--cta, .wa-fab').forEach(btn => {
      btn.addEventListener('mousemove', e => {
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width  / 2;
        const cy = rect.top  + rect.height / 2;
        const dx = (e.clientX - cx) * STRENGTH;
        const dy = (e.clientY - cy) * STRENGTH;
        btn.style.transform = `translate(${dx}px, ${dy}px)`;
      });

      btn.addEventListener('mouseleave', () => {
        // Spring back
        btn.style.transition = 'transform 0.45s cubic-bezier(0.23, 1, 0.32, 1)';
        btn.style.transform = 'translate(0, 0)';
        setTimeout(() => { btn.style.transition = ''; }, 450);
      });

      btn.addEventListener('mouseenter', () => {
        btn.style.transition = 'transform 0.18s ease';
      });
    });

    // Cursor glow that follows the mouse on dark sections
    const glow = document.createElement('div');
    glow.style.cssText = `
      position:fixed; pointer-events:none; z-index:999;
      width:280px; height:280px; border-radius:50%;
      background:radial-gradient(circle, rgba(14,165,233,0.08) 0%, transparent 70%);
      transform:translate(-50%,-50%);
      transition:opacity 0.4s ease;
      opacity:0;
    `;
    document.body.appendChild(glow);

    let glowVisible = false;
    document.addEventListener('mousemove', e => {
      glow.style.left = e.clientX + 'px';
      glow.style.top  = e.clientY + 'px';
    });

    // Only show glow on dark sections
    const darkSections = document.querySelectorAll('#hero, #why, #about, #estimator, #tools, #testimonials, #cta-strip');
    const glowObserver = new IntersectionObserver(entries => {
      const anyVisible = [...darkSections].some(s => s.classList.contains('in-view-glow'));
      glow.style.opacity = anyVisible ? '1' : '0';
    }, { threshold: 0.1 });
    darkSections.forEach(s => {
      glowObserver.observe(s);
      const io = new IntersectionObserver(([e]) => {
        s.classList.toggle('in-view-glow', e.isIntersecting);
        const anyV = [...darkSections].some(x => x.classList.contains('in-view-glow'));
        glow.style.opacity = anyV ? '1' : '0';
      }, { threshold: 0.1 });
      io.observe(s);
    });
  })();
