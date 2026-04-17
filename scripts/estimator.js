  (function() {
    // State
    let selectedMat = null, matRate = 1, selectedSize = null, basePrice = 0;

    const stepDots = document.querySelectorAll('.estimator-step-dot');
    function setStep(n) {
      document.querySelectorAll('.estimator-panel').forEach((p, i) => p.classList.toggle('is-active', i === n));
      stepDots.forEach((d, i) => {
        d.classList.toggle('is-active', i === n);
        d.classList.toggle('is-done',   i < n);
      });
    }

    // Step 1: material selection
    document.querySelectorAll('.est-mat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.est-mat-btn').forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        selectedMat = btn.dataset.mat;
        matRate     = parseFloat(btn.dataset.rate);
        document.getElementById('estNext0').disabled = false;
      });
    });
    document.getElementById('estNext0').addEventListener('click', () => {
      if (!selectedMat) return;
      setStep(1);
    });

    // Step 2: size + qty + infill
    document.querySelectorAll('.est-size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.est-size-btn').forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        selectedSize = btn.dataset.size;
        basePrice    = parseInt(btn.dataset.base, 10);
        document.getElementById('estNext1').disabled = false;
      });
    });

    const qtySlider    = document.getElementById('estQty');
    const infillSlider = document.getElementById('estInfill');
    const qtyVal       = document.getElementById('qtyVal');
    const infillVal    = document.getElementById('infillVal');
    qtySlider.addEventListener('input',    () => { qtyVal.textContent    = qtySlider.value; });
    infillSlider.addEventListener('input', () => { infillVal.textContent = infillSlider.value + '%'; });

    document.getElementById('estBack1').addEventListener('click', () => setStep(0));
    document.getElementById('estNext1').addEventListener('click', () => {
      if (!selectedSize) return;
      const qty      = parseInt(qtySlider.value, 10);
      const infill   = parseInt(infillSlider.value, 10);
      // Infill multiplier: 10% = 0.75x density, 100% = 1.6x density
      const infillMult = 0.75 + (infill / 100) * 0.85;
      // Bulk discount: >5 units = 10%, >10 = 20%
      const bulkDisc   = qty > 10 ? 0.8 : qty > 5 ? 0.9 : 1.0;

      const unitLow  = Math.round(basePrice * matRate * infillMult * 0.8);
      const unitHigh = Math.round(basePrice * matRate * infillMult * 1.3);
      const totalLow  = Math.round(unitLow  * qty * bulkDisc);
      const totalHigh = Math.round(unitHigh * qty * bulkDisc);

      // Format with thousand separators
      const fmt = n => n.toLocaleString('en-ZA');
      document.getElementById('estPrice').innerHTML = `R<em>${fmt(totalLow)} – R${fmt(totalHigh)}</em>`;

      // Summary pills
      const summaryEl = document.getElementById('estSummary');
      const pills = [
        { icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>', label: selectedMat },
        { icon: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>', label: selectedSize + ' part' },
        { icon: '<path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0"/><path d="M12 8v4l3 3"/>', label: 'Qty: ' + qty },
        { icon: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>', label: 'Infill: ' + infill + '%' },
      ];
      summaryEl.innerHTML = pills.map(p =>
        `<span class="est-result-pill"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg>${p.label}</span>`
      ).join('');

      setStep(2);
    });

    // Back to start
    document.getElementById('estBack2').addEventListener('click', () => {
      selectedMat = null; selectedSize = null; basePrice = 0; matRate = 1;
      document.querySelectorAll('.est-mat-btn, .est-size-btn').forEach(b => b.classList.remove('is-selected'));
      document.getElementById('estNext0').disabled = true;
      document.getElementById('estNext1').disabled = true;
      qtySlider.value = 1; qtyVal.textContent = '1';
      infillSlider.value = 20; infillVal.textContent = '20%';
      // Reset AI panel
      const aiResult = document.getElementById('estAiResult');
      if (aiResult) { aiResult.style.display = 'none'; aiResult.innerHTML = ''; }
      const aiBtn = document.getElementById('estAiBtn');
      if (aiBtn) { aiBtn.disabled = false; aiBtn.innerHTML = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> ✦ Get AI Analysis — deeper breakdown'; }
      setStep(0);
    });

    // AI analysis button
    const aiBtn = document.getElementById('estAiBtn');
    const aiResult = document.getElementById('estAiResult');
    if (aiBtn && aiResult) {
      aiBtn.addEventListener('click', async () => {
        if (!selectedMat || !selectedSize) return;
        aiBtn.disabled = true;
        aiBtn.innerHTML = '<span class="est-ai-spinner"></span> Analysing with AI…';
        aiResult.style.display = 'none';

        try {
          const res = await fetch('/api/ai-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              material: selectedMat,
              size: selectedSize,
              qty: qtySlider.value,
              infill: infillSlider.value,
              description: ''
            })
          });

          if (!res.ok) throw new Error('API error ' + res.status);
          const data = await res.json();
          const conf = (data.confidence || 'Medium').toLowerCase();

          aiResult.innerHTML = `
            <div class="est-ai-result">
              <div class="est-ai-price">R${(data.priceRange?.low || '—').toLocaleString('en-ZA')} – R${(data.priceRange?.high || '—').toLocaleString('en-ZA')}</div>
              <div class="est-ai-time">⏱ ${data.printTime?.estimate || '—'} &nbsp;·&nbsp; Lead time: ${data.leadTime || '2–5 business days'}</div>
              ${data.materialAdvice ? `<div class="est-ai-advice">${data.materialAdvice}</div>` : ''}
              ${data.designTips?.length ? `<ul class="est-ai-tips">${data.designTips.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
              <div class="est-ai-confidence ${conf}">
                ${conf === 'high' ? '● High confidence' : conf === 'medium' ? '◐ Medium confidence' : '○ Low confidence'}
              </div>
              ${data.confidenceNote ? `<div class="est-ai-alt" style="margin-top:6px;font-size:0.75rem;">${data.confidenceNote}</div>` : ''}
              ${data.alternativeMaterial ? `<div class="est-ai-alt">💡 Consider <strong>${data.alternativeMaterial}</strong> as an alternative</div>` : ''}
            </div>
          `;
          aiResult.style.display = 'block';
          aiBtn.innerHTML = '✓ Analysis complete — scroll up to see';
        } catch (err) {
          aiResult.innerHTML = '<div class="est-ai-result" style="color:rgba(255,255,255,0.4);font-size:0.82rem;">AI analysis unavailable right now — your estimate above is still accurate. <a href="#contact" style="color:#a5b4fc;">Request exact quote →</a></div>';
          aiResult.style.display = 'block';
          aiBtn.disabled = false;
          aiBtn.innerHTML = '↺ Retry AI Analysis';
        }
      });
    }
  })();
