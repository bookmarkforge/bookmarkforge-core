/**
 * Landing page JavaScript
 * - Theme toggle (dark/light) with localStorage persistence
 */

(function() {
  'use strict';

  // ── Theme Toggle ─────────────────────────────────────────────────
  const themeToggle = document.getElementById('themeToggle');
  const themeIconLight = document.querySelector('.theme-icon-light');
  const themeIconDark = document.querySelector('.theme-icon-dark');
  const html = document.documentElement;

  function applyTheme(theme) {
    if (theme === 'light') {
      html.setAttribute('data-theme', 'light');
      themeIconLight.style.display = 'none';
      themeIconDark.style.display = 'block';
      themeToggle.setAttribute('aria-pressed', 'true');
    } else {
      html.removeAttribute('data-theme');
      themeIconLight.style.display = 'block';
      themeIconDark.style.display = 'none';
      themeToggle.setAttribute('aria-pressed', 'false');
    }
  }

  // Load saved theme or respect system preference
  function initTheme() {
    const saved = localStorage.getItem('bmf_landing_theme');
    if (saved) {
      applyTheme(saved);
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      applyTheme('light');
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isLight = html.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';
      localStorage.setItem('bmf_landing_theme', next);
      applyTheme(next);
    });
  }

  initTheme();

  // ── Force Service Worker Update Check ─────────────────────
  // Force service worker to check for updates on page load
  // This ensures users get the latest version with language fixes
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      registration.update();
    }).catch(() => {
      // Silent fail if SW registration fails
    });
  }

  // ── Language Dropdown ─────────────────────────────────────────────
  const languageToggle = document.querySelector('.language-toggle');
  const languageMenu = document.querySelector('.language-menu');

  if (languageToggle && languageMenu) {
    languageToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = languageToggle.getAttribute('aria-expanded') === 'true';
      languageToggle.setAttribute('aria-expanded', !isExpanded);
      languageMenu.setAttribute('aria-hidden', isExpanded);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      languageToggle.setAttribute('aria-expanded', 'false');
      languageMenu.setAttribute('aria-hidden', 'true');
    });

    // Close dropdown when clicking on a language link
    languageMenu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        languageToggle.setAttribute('aria-expanded', 'false');
        languageMenu.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // ── Smooth Scroll for anchor links ───────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Update URL without jumping
        history.pushState(null, '', targetId);
      }
    });
  });

  // ── Intersection Observer for scroll animations ──────────────────
  const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // Add initial styles for animation
  document.querySelectorAll('.feature-card, .privacy-card, .pricing-card, .mode-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(el);
  });

  // Hero content animation
  const heroContent = document.querySelector('.hero-content');
  if (heroContent) {
    heroContent.style.opacity = '0';
    heroContent.style.transform = 'translateY(20px)';
    heroContent.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
    setTimeout(() => {
      heroContent.style.opacity = '1';
      heroContent.style.transform = 'translateY(0)';
    }, 100);
  }

  const heroVisual = document.querySelector('.hero-visual');
  if (heroVisual) {
    heroVisual.style.opacity = '0';
    heroVisual.style.transform = 'translateY(20px)';
    heroVisual.style.transition = 'opacity 0.8s ease 0.2s, transform 0.8s ease 0.2s';
    setTimeout(() => {
      heroVisual.style.opacity = '1';
      heroVisual.style.transform = 'translateY(0)';
    }, 300);
  }

  // ── Language preference (?lang= + bf_lang/nf_lang cookies) ───────
  // The server negotiates the landing by Accept-Language, which bounces a
  // user back to their browser's language even after they pick another one
  // manually. Choosing a language (nav/footer links carry ?lang=xx) sets a
  // persistent cookie so the redirect stops firing: bf_lang is read by
  // nginx + the Cloudflare middleware, nf_lang is Netlify's native override
  // for its Language conditions. Same contract in scripts/nginx-render.mjs
  // and functions/_middleware.js, pinned by scripts/check-seo.mjs.
  const LANG_CODES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'ar', 'bg', 'cs', 'da', 'el', 'fi', 'he', 'hi', 'hr', 'hu', 'id', 'ja', 'ko', 'nl', 'no', 'pl', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'];

  function setLangPreference(lang) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    const attrs = `Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.cookie = `bf_lang=${lang}; ${attrs}`;
    document.cookie = `nf_lang=${lang}; ${attrs}`;
  }

  // ?lang=xx on ANY landing page: record the choice persistently and move
  // to the matching landing (or strip the query when already there).
  function handleLangParam() {
    const params = new URLSearchParams(window.location.search);
    const lang = (params.get('lang') || '').toLowerCase();
    if (!LANG_CODES.includes(lang)) return;
    setLangPreference(lang);
    const target = lang === 'en' ? '/' : `/${lang}/`;
    if (window.location.pathname !== target) {
      window.location.replace(target);
    } else {
      window.history.replaceState(null, '', target);
    }
  }

  // Clicking a language link records the choice BEFORE navigating — needed
  // on hosts whose edge negotiates before any JS runs (e.g. Netlify's
  // Language conditions).
  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a[href*="lang="]') : null;
    if (!link) return;
    var match = (link.getAttribute('href') || '').match(/[?&]lang=([a-z]{2})/i);
    if (match && LANG_CODES.indexOf(match[1].toLowerCase()) !== -1) {
      setLangPreference(match[1].toLowerCase());
      
      // In local development, navigate to the localized HTML file
      // since Vite dev server serves the public directory
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        event.preventDefault();
        var lang = match[1].toLowerCase();
        var target = lang === 'en' ? '/' : '/' + lang + '.html';
        window.location.href = target;
      }
    }
  });

  // ── Fix help links in local development ───────────────────────────
  // In production, /help is rewritten to help.html by the server
  // In local development, we need to append .html to make it work
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    document.addEventListener('click', function (event) {
      var link = event.target.closest ? event.target.closest('a[href^="/help"]') : null;
      if (!link) return;
      var href = link.getAttribute('href');
      // Detect current language from URL or cookie
      var currentLang = window.location.pathname.match(/^\/([a-z]{2})\.html/);
      var langCode = currentLang ? currentLang[1] : null;
      if (!langCode) {
        var langCookie = localStorage.getItem('bf_lang');
        if (langCookie) langCode = langCookie;
      }

      if (href === '/help' || href === '/help#sla' || href === '/help#pricing' || href === '/help#bf-e' || href === '/help#bf-e101') {
        event.preventDefault();
        var helpPath = langCode ? '/help-' + langCode + '.html' : '/help.html';
        var hash = href.includes('#') ? href.split('#')[1] : '';
        window.location.href = helpPath + (hash ? '#' + hash : '');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleLangParam);
  } else {
    handleLangParam();
  }

  // ── Whop Early Bird stock ───────────────────────────────────────
  // The API key stays server-side in Vercel. If the 200 Early Bird
  // licenses are exhausted, switch the pricing card to the $79 plan.
  async function refreshEarlyBirdStatus() {
    const earlyLink = document.querySelector('a[href="https://whop.com/checkout/plan_9oP0DrBuqFEb7"]');
    const regularLink = document.querySelector('a[href="https://whop.com/checkout/plan_FTmrDjPDKqQVC"]');
    const card = earlyLink ? earlyLink.closest('.price-card') : null;

    if (!card) return;

    try {
      const response = await fetch('/api/early-bird-status', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) return;

      const status = await response.json();
      if (status.available !== false) return;

      // If a Regular CTA is not present on an older localized landing,
      // create one so the sold-out state still has a working purchase path.
      let proLink = regularLink;
      if (!proLink && earlyLink) {
        proLink = document.createElement('a');
        proLink.href = 'https://whop.com/checkout/plan_FTmrDjPDKqQVC';
        proLink.target = '_blank';
        proLink.rel = 'noopener noreferrer';
        proLink.className = earlyLink.className.replace('btn-primary', 'btn-secondary');
        proLink.textContent = 'Get Pro $79 Regular';
        earlyLink.insertAdjacentElement('afterend', proLink);
      }

      if (earlyLink) {
        earlyLink.hidden = true;
        earlyLink.setAttribute('aria-hidden', 'true');
      }

      if (proLink) {
        proLink.hidden = false;
        proLink.removeAttribute('aria-hidden');
        proLink.textContent = 'Get Pro $79 Regular';
      }

      // Update the visible pricing copy inside the Pro card.
      card.querySelectorAll('*').forEach((el) => {
        if (el.children.length !== 0) return;
        const text = el.textContent || '';
        if (/Early Bird/i.test(text)) {
          if (el.classList.contains('badge') || el.classList.contains('badge-early')) {
            el.textContent = 'Pro Lifetime v1 — $79';
          } else {
            el.textContent = text
              .replace(/Early Bird\s*\(then\s*\$?79\)/gi, 'Regular')
              .replace(/Early Bird\s*—\s*200/gi, 'Regular')
              .replace(/Early Bird/gi, 'Regular');
          }
        }
        if (/\$\s*59\b/.test(text)) {
          el.textContent = text.replace(/\$\s*59\b/g, '$ 79');
        }
      });

      card.classList.add('regular-price');
    } catch {
      // Fail closed to the current static Early Bird presentation.
      // Whop remains the source of truth for checkout availability.
    }
  }

  refreshEarlyBirdStatus();
  window.setInterval(refreshEarlyBirdStatus, 5 * 60 * 1000);

})();