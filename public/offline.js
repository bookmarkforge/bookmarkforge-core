/* Offline page behavior — extracted from the inline <script> of
   public/offline.html so it runs under the strict CSP (script-src 'self'
   blocks inline scripts). Keep in sync with public/offline.html. */
const statusEl = document.getElementById('status');
const btn = document.getElementById('retry-btn');

btn.addEventListener('click', async function() {
  statusEl.textContent = 'Checking connection...';
  btn.disabled = true;
  try {
    const res = await fetch('/_health', { method: 'HEAD', cache: 'no-store' });
    if (res.ok) {
      statusEl.textContent = 'Connected! Reloading...';
      window.location.reload();
    } else {
      statusEl.textContent = 'Still offline — try again in a moment.';
    }
  } catch {
    statusEl.textContent = 'Still offline — try again in a moment.';
  } finally {
    btn.disabled = false;
  }
});
