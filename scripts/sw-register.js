  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => console.log('[SW] Registered, scope:', reg.scope))
        .catch(err => console.warn('[SW] Registration failed:', err));
    });
  }
