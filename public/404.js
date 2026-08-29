/* 404 page behavior — extracted from the inline <script> of public/404.html.
   External file so it runs under the strict CSP (script-src 'self' blocks
   inline scripts). Keep in sync with public/404.html. */
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('go-back-btn').addEventListener('click', goBack);

function setIcons(theme) {
    var sun = document.querySelector('.theme-icon-light');
    var moon = document.querySelector('.theme-icon-dark');
    if (!sun || !moon) return;
    if (theme === 'dark') {
        sun.style.display = 'none';
        moon.style.display = '';
    } else {
        sun.style.display = '';
        moon.style.display = 'none';
    }
}

function toggleTheme() {
    var current = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    setIcons(applyTheme(current));
}

function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch(_e) { /* best-effort */ }
    return theme;
}

/* Default is brand dark (matches src/index.css "Dark Flat UI"). */
try {
    var saved = localStorage.getItem('theme');
    var initial = (saved === 'light' || saved === 'dark') ? saved : 'dark';
    setIcons(applyTheme(initial));
} catch(_e) { /* best-effort */ }

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = '/';
    }
}