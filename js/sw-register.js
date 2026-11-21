export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });

      const showUpdateBanner = (worker) => {
        const banner = document.getElementById('update-banner');
        const btn = document.getElementById('btn-apply-update');
        if (!banner || !btn) return;
        banner.hidden = false;
        btn.onclick = () => {
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
      };

      if (reg.waiting) {
        showUpdateBanner(reg.waiting);
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker);
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (err) {
      console.error('Error registrando Service Worker:', err);
    }
  });
}