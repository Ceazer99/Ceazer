/* Ceazers 3D - projects.js
   Renders the Projects section from scripts/projects-data.js:
   featured cards, a filterable gallery, and a photo/video lightbox.
   Must load BEFORE core.js so core.js picks up the cards' fade-up / tilt hooks. */
(function () {
  'use strict';

  const projects   = window.C3D_PROJECTS || [];
  const categories = window.C3D_CATEGORIES || [];
  const grid       = document.getElementById('projectsGrid');
  const galleryEl  = document.getElementById('projectGallery');
  if (!grid || !projects.length) return;

  const bySlug = Object.fromEntries(projects.map(p => [p.slug, p]));
  const img = (slug, n, small) => `images/projects/${slug}-${n}${small ? '-sm' : ''}.webp`;
  // Card/tile image: first photo, or the first video's poster for video-only projects
  const coverOf = p => (p.photos || []).length ? img(p.slug, 1, true) : (p.videos?.[0]?.poster || '');

  /* Media list for a project: photos first, then videos */
  function mediaOf(p) {
    const photos = (p.photos || []).map((alt, i) => ({ type: 'image', src: img(p.slug, i + 1), alt }));
    const videos = (p.videos || []).map(v => ({ type: 'video', src: v.src, poster: v.poster, alt: v.title }));
    return photos.concat(videos);
  }

  /* Tiny DOM helper - text is always set via textContent (no HTML injection) */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    children.forEach(c => c && node.appendChild(c));
    return node;
  }

  const ICON = {
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    play:   '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
    arrow:  '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  };

  function countBadge(p) {
    const nP = (p.photos || []).length, nV = (p.videos || []).length;
    const b = el('span', { class: 'project-count', 'aria-hidden': 'true' });
    b.innerHTML = (nP ? `${ICON.camera}${nP}` : '') + (nV ? ` ${ICON.play}${nV}` : '');
    return b;
  }

  /* ── Featured cards ─────────────────────────────────────────── */
  projects.filter(p => p.featured).forEach((p, i) => {
    const nV = (p.videos || []).length;
    const label = nV ? 'View photos & videos' : 'View photos';

    const image = el('button', {
      class: 'project-image', type: 'button', 'data-open': p.slug,
      'aria-label': `${label}: ${p.title}`,
    }, [
      el('span', { class: 'project-tag', text: p.tag }),
      el('img', {
        src: img(p.slug, 1, true), alt: p.photos[0], loading: 'lazy', decoding: 'async',
        class: 'project-photo site-img' + (p.fit === 'contain' ? ' is-contain' : ''),
      }),
      countBadge(p),
    ]);

    const chips = el('ul', { class: 'project-chips', 'aria-label': 'What we did' },
      (p.chips || []).map(c => el('li', { text: c })));

    const viewBtn = el('button', { class: 'project-view', type: 'button', 'data-open': p.slug, text: label });
    const enquire = el('a', { href: '#contact', class: 'project-arrow' });
    enquire.innerHTML = `Enquire ${ICON.arrow}`;

    grid.appendChild(el('article', { class: `project-card tilt-card fade-up fade-up-delay-${(i % 3) + 1}` }, [
      image,
      el('div', { class: 'project-info' }, [
        el('h3', { class: 'project-title', text: p.title }),
        el('p', { class: 'project-desc', text: p.desc }),
        chips,
        el('div', { class: 'project-meta' }, [viewBtn, enquire]),
      ]),
    ]));
  });

  /* ── Gallery with category filter ───────────────────────────── */
  if (galleryEl) {
    const items = projects.filter(p => !p.featured);
    const used  = categories.filter(c => items.some(p => p.category === c.id));

    const tabs = el('div', { class: 'pg-tabs', role: 'group', 'aria-label': 'Filter projects' });
    const addTab = (id, label, pressed) => tabs.appendChild(
      el('button', { type: 'button', class: 'pg-tab', 'data-filter': id, 'aria-pressed': String(pressed), text: label }));
    addTab('all', 'All', true);
    used.forEach(c => addTab(c.id, c.label, false));

    const tileGrid = el('div', { class: 'pg-grid' });
    items.forEach(p => {
      const n = mediaOf(p).length;
      tileGrid.appendChild(el('button', {
        type: 'button', class: 'pg-tile', 'data-open': p.slug, 'data-cat': p.category,
        'aria-label': `${p.title}: view ${n} ${n === 1 ? 'item' : 'items'}`,
      }, [
        el('span', { class: 'pg-thumb' + (p.fit === 'contain' ? ' is-contain' : '') }, [
          el('img', { src: coverOf(p), alt: '', loading: 'lazy', decoding: 'async' }),
          (n > 1 || (p.videos || []).length) ? countBadge(p) : null,
        ]),
        el('span', { class: 'pg-caption' }, [
          el('span', { class: 'pg-title', text: p.title }),
          el('span', { class: 'pg-desc', text: p.desc }),
        ]),
      ]));
    });

    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.pg-tab');
      if (!btn) return;
      tabs.querySelectorAll('.pg-tab').forEach(t => t.setAttribute('aria-pressed', String(t === btn)));
      const f = btn.dataset.filter;
      tileGrid.querySelectorAll('.pg-tile').forEach(t => { t.hidden = f !== 'all' && t.dataset.cat !== f; });
    });

    galleryEl.append(
      el('div', { class: 'pg-head' }, [el('h3', { class: 'pg-heading', text: 'More Projects' }), tabs]),
      tileGrid,
    );
  }

  /* ── Lightbox ───────────────────────────────────────────────── */
  const lb = el('div', { class: 'lb', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lbTitle', hidden: true });
  lb.innerHTML = `
    <div class="lb-top">
      <div class="lb-heading"><span class="lb-title" id="lbTitle"></span><span class="lb-counter" aria-live="polite"></span></div>
      <button type="button" class="lb-btn lb-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="lb-stage"></div>
    <p class="lb-caption"></p>
    <button type="button" class="lb-btn lb-prev" aria-label="Previous">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <button type="button" class="lb-btn lb-next" aria-label="Next">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;
  document.body.appendChild(lb);

  const $ = s => lb.querySelector(s);
  const stage = $('.lb-stage'), caption = $('.lb-caption'), counter = $('.lb-counter');
  let media = [], index = 0, lastFocus = null;

  function show(i) {
    index = (i + media.length) % media.length;
    const m = media[index];
    stage.replaceChildren(m.type === 'video'
      ? el('video', { src: m.src, poster: m.poster, controls: true, playsinline: true, autoplay: true, preload: 'metadata', 'aria-label': m.alt })
      : el('img', { src: m.src, alt: m.alt }));
    caption.textContent = m.alt || '';
    counter.textContent = media.length > 1 ? `${index + 1} / ${media.length}` : '';
    const multi = media.length > 1;
    $('.lb-prev').hidden = !multi;
    $('.lb-next').hidden = !multi;
    // Preload the next image
    const next = media[(index + 1) % media.length];
    if (multi && next.type === 'image') new Image().src = next.src;
  }

  function open(slug) {
    const p = bySlug[slug];
    if (!p) return;
    media = mediaOf(p);
    if (!media.length) return;
    lastFocus = document.activeElement;
    $('.lb-title').textContent = p.title;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    show(0);
    $('.lb-close').focus();
  }

  function close() {
    lb.hidden = true;
    stage.replaceChildren(); // stops any playing video
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open]');
    if (t) { e.preventDefault(); open(t.dataset.open); }
  });
  $('.lb-close').addEventListener('click', close);
  $('.lb-prev').addEventListener('click', () => show(index - 1));
  $('.lb-next').addEventListener('click', () => show(index + 1));
  lb.addEventListener('click', e => { if (e.target === lb || e.target === stage) close(); });

  document.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && media.length > 1) show(index - 1);
    else if (e.key === 'ArrowRight' && media.length > 1) show(index + 1);
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...lb.querySelectorAll('button:not([hidden]), video')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Swipe left/right on touch screens
  let touchX = null;
  stage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (touchX == null || media.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    touchX = null;
  });
})();
