    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

    (function initHero3D() {
      const container = document.getElementById('hero3dViewer');
      const heroVisual = container?.closest('.hero-visual');
      if (!container || !heroVisual) return;

      // WebGL support check - fall back to static image gracefully
      try {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
        if (!gl) return;
      } catch (e) { return; }

      // ── Renderer ──────────────────────────────────────────────
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.3;
      renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;outline:none;';
      container.appendChild(renderer.domElement);

      // ── Scene ─────────────────────────────────────────────────
      const scene = new THREE.Scene();

      // ── Camera ────────────────────────────────────────────────
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
      camera.position.set(0, 0.6, 6.5);

      // ── Controls ──────────────────────────────────────────────
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping    = true;
      controls.dampingFactor    = 0.07;
      controls.enablePan        = false;
      controls.minDistance      = 3.5;
      controls.maxDistance      = 11;
      controls.minPolarAngle    = Math.PI * 0.15;
      controls.maxPolarAngle    = Math.PI * 0.78;
      controls.autoRotate       = true;
      controls.autoRotateSpeed  = 1.6;
      controls.target.set(0, 0.15, 0);

      // ── Lights ────────────────────────────────────────────────
      // Sky/ground hemisphere
      const hemi = new THREE.HemisphereLight(0x93c5fd, 0x080C14, 0.55);
      scene.add(hemi);

      // Key light (warm white from upper right)
      const key = new THREE.DirectionalLight(0xffffff, 4.2);
      key.position.set(4, 8, 5);
      scene.add(key);

      // Fill light (brand blue from left)
      const fill = new THREE.DirectionalLight(0x38bdf8, 1.4);
      fill.position.set(-6, 2, -2);
      scene.add(fill);

      // Rim light (orange accent from below-back - makes edges glow)
      const rim = new THREE.DirectionalLight(0xF97316, 1.1);
      rim.position.set(1, -5, -7);
      scene.add(rim);

      // ── L-Bracket geometry ────────────────────────────────────
      // Profile of a standard engineering L-bracket
      const shape = new THREE.Shape();
      shape.moveTo(-1.85, -0.72);
      shape.lineTo( 1.85, -0.72);
      shape.lineTo( 1.85,  0.72);
      shape.lineTo( 0.48,  0.72);
      shape.lineTo( 0.48,  2.32);
      shape.lineTo(-0.48,  2.32);
      shape.lineTo(-0.48,  0.72);
      shape.lineTo(-1.85,  0.72);
      shape.closePath();

      // Bolt / mounting holes
      [[-1.25, 0], [1.25, 0], [0, 1.6]].forEach(([x, y]) => {
        const hole = new THREE.Path();
        hole.absarc(x, y, 0.2, 0, Math.PI * 2, false);
        shape.holes.push(hole);
      });

      const extrudeSettings = {
        depth: 0.24,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.04,
        bevelSegments: 5
      };
      const bracketGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      bracketGeo.center();
      bracketGeo.computeVertexNormals();

      // Brand-blue matte engineering part
      const bracketMat = new THREE.MeshStandardMaterial({
        color:     new THREE.Color('#0EA5E9'),
        roughness: 0.40,
        metalness: 0.18
      });
      const bracket = new THREE.Mesh(bracketGeo, bracketMat);
      bracket.rotation.x = -0.12;  // slight tilt so top/front both visible on load
      scene.add(bracket);

      // ── FDM layer-line effect ─────────────────────────────────
      // Thin horizontal lines across the face suggest printed layers
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x075985,
        transparent: true,
        opacity: 0.35
      });
      const layerGroup = new THREE.Group();
      const layerStep = 0.1;
      for (let y = -0.9; y <= 2.0; y += layerStep) {
        const pts = [];
        // horizontal span depends on Y position (inside the L-shape)
        const xRight = y < 0.72 ? 1.85 : 0.48;
        const xLeft  = y < 0.72 ? -1.85 : -0.48;
        pts.push(new THREE.Vector3(xLeft,  y, 0.13));
        pts.push(new THREE.Vector3(xRight, y, 0.13));
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        layerGroup.add(new THREE.Line(lineGeo, lineMat));
      }
      layerGroup.rotation.x = -0.12;
      // vertically offset to match bracket center
      scene.add(layerGroup);

      // ── Floating particles ────────────────────────────────────
      const N = 80;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3]     = (Math.random() - 0.5) * 9;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 5;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.035, transparent: true, opacity: 0.55, sizeAttenuation: true });
      scene.add(new THREE.Points(pGeo, pMat));

      // ── Reduced motion preference ─────────────────────────────
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        controls.autoRotate    = false;
        controls.enableDamping = false;
      }

      // ── Hint: hide on first drag/touch ────────────────────────
      const hint = document.getElementById('hero3dHint');
      let hintDismissed = false;
      controls.addEventListener('start', () => {
        controls.autoRotate = false;
        if (!hintDismissed && hint) {
          hint.classList.add('is-hidden');
          hintDismissed = true;
        }
      });

      // ── Resize ────────────────────────────────────────────────
      function onResize() {
        const w = container.offsetWidth  || 1;
        const h = container.offsetHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      new ResizeObserver(onResize).observe(container);
      onResize();

      // ── Render loop ───────────────────────────────────────────
      const clock = new THREE.Clock();
      let running = true;
      let rafId   = null;

      function animate() {
        if (!running) return;
        rafId = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();

        // Gentle floating bob
        bracket.position.y = Math.sin(t * 0.55) * 0.06;
        layerGroup.position.y = bracket.position.y;

        // Slow particle drift
        const pMesh = scene.children.find(c => c.isPoints);
        if (pMesh) pMesh.rotation.y = t * 0.035;

        controls.update();
        renderer.render(scene, camera);
      }

      // Pause when scrolled off-screen (saves battery on mobile)
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          running = e.isIntersecting;
          if (running && !rafId) animate();
          if (!running && rafId) { cancelAnimationFrame(rafId); rafId = null; }
        });
      }, { threshold: 0.05 });
      io.observe(container);

      // ── Go ────────────────────────────────────────────────────
      heroVisual.classList.add('has-3d');
      container.classList.add('is-ready');
      animate();

    })();
