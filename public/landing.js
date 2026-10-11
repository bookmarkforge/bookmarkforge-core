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

  // The icons and the toggle are optional: a page that loads landing.js
  // without them must not abort the whole IIFE (which would silently kill the
  // language preference and the pricing-card switch below).
  function applyTheme(theme) {
    if (theme === 'light') {
      html.setAttribute('data-theme', 'light');
      if (themeIconLight) themeIconLight.style.display = 'none';
      if (themeIconDark) themeIconDark.style.display = 'block';
      if (themeToggle) themeToggle.setAttribute('aria-pressed', 'true');
    } else {
      html.removeAttribute('data-theme');
      if (themeIconLight) themeIconLight.style.display = 'block';
      if (themeIconDark) themeIconDark.style.display = 'none';
      if (themeToggle) themeToggle.setAttribute('aria-pressed', 'false');
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
    // Mirrored in localStorage: the help-link mapping below reads it, and the
    // cookie alone is invisible to the client-side fallback on hosts without
    // server negotiation.
    try {
      localStorage.setItem('bf_lang', lang);
    } catch (_e) {
      /* storage disabled: the cookies above still carry the choice */
    }
  }

  /** The recorded language preference (cookie first — it is the server's copy —
   *  then localStorage). Empty string when there is none. */
  function readStoredLanguage() {
    try {
      const fromCookie = document.cookie.match(/(?:^|;\s*)bf_lang=([^;]*)/);
      if (fromCookie) {
        const value = decodeURIComponent(fromCookie[1]).toLowerCase();
        if (LANG_CODES.indexOf(value) !== -1) return value;
      }
      const fromStorage = (localStorage.getItem('bf_lang') || '').toLowerCase();
      return LANG_CODES.indexOf(fromStorage) !== -1 ? fromStorage : '';
    } catch (_e) {
      return '';
    }
  }

  // The language of the landing the visitor is ON. Returns null for pages
  // that carry no language of their own (/help, /privacy-and-terms,
  // /offline, /pocket-alternative are EN-only and visiting one is not a
  // choice) — recording those would pin an ES visitor to EN.
  function pageLanguage() {
    const p = window.location.pathname;
    const dir = p.match(/^\/([a-z]{2})(?:\/|$)/);
    if (dir && LANG_CODES.indexOf(dir[1]) !== -1) return dir[1];
    const file = p.match(/^\/([a-z]{2})\.html$/);
    if (file && LANG_CODES.indexOf(file[1]) !== -1) return file[1];
    if (p === '/' || p === '/index.html' || p === '/landing.html') return 'en';
    return null;
  }

  // Recording a language the moment the page is served is what makes a choice
  // stick across landings: the visible language links are clean (/es/, not
  // ?lang=es — the SEO gate forbids the query on 29 of the 30 pages), so a
  // click is no longer a signal the handler below can see on every host. It is
  // also what stops the worst case: choosing "English" on /es/ used to leave
  // ?lang=es in the cookie, so the next visit to / was bounced straight back to
  // /es/ by any host that negotiates (nginx, Cloudflare, Netlify).
  const storedLanguage = readStoredLanguage();
  const servedLanguage = pageLanguage();
  if (servedLanguage) setLangPreference(servedLanguage);

  // Hosts that negotiate (nginx, the Cloudflare middleware, Netlify's Language
  // conditions) already bounce / to the locale recorded in bf_lang — nginx.conf
  // rewrites `^ /<lang>/ redirect` for every one of the 29 locales. Vercel has
  // no server-side negotiation at all, so there the choice was silently lost:
  // / rendered the EN landing whatever the visitor had picked. This mirrors the
  // server rule on the one host that cannot apply it.
  //
  // It only ever runs on the EN root landing (never on /es/ or on a
  // language-agnostic page), so it cannot ping-pong; an explicit "English" pick
  // rewrites the preference from the click handler before navigating here; and
  // a ?lang= in the URL always wins (handled by handleLangParam below).
  function applyStoredLanguagePreference() {
    if (servedLanguage !== 'en') return;
    const params = new URLSearchParams(window.location.search);
    if (LANG_CODES.indexOf((params.get('lang') || '').toLowerCase()) !== -1) return;
    if (!storedLanguage || storedLanguage === 'en' || storedLanguage === servedLanguage) return;
    const isLocalDev =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    window.location.replace(isLocalDev ? `/${storedLanguage}.html` : `/${storedLanguage}/`);
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
  // The language a link points at, from any of the three forms the pages
  // ship: the legacy query (/id/?lang=id, still on index.html), the clean
  // locale link every generated page carries (/id/ or /id), and the EN root
  // landing (/ — what the "English" entry links to). Recording from the click
  // is what stops a host that negotiates BEFORE any JS runs (Netlify's
  // Language conditions, an nginx proxy) from bouncing the visitor straight
  // back to the language they just left.
  function languageForHref(href) {
    var query = href.match(/[?&]lang=([a-z]{2})/i);
    if (query) return query[1].toLowerCase();
    var clean = href.match(/^\/([a-z]{2})\/?$/);
    if (clean) return clean[1].toLowerCase();
    if (href === '/' || href === '/index.html' || href === '/landing.html') return 'en';
    return null;
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('a') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    var chosen = languageForHref(href);
    var match = chosen ? [href, chosen] : null;
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

  applyStoredLanguagePreference();

  // ── Early Bird availability ─────────────────────────────────────
  // The status comes from /api/early-bird-status.json, generated at build
  // time from src/constants/pricing.ts (scripts/generate-early-bird-status.mjs):
  // the landing and the app can never disagree about the active price phase,
  // and flipping earlyBird.phase + `npm run build:landings` switches both.
  // If the status is missing or unreadable we keep the static Early Bird
  // presentation — Whop stays the source of truth for checkout availability.
  const EARLY_CHECKOUT = 'https://whop.com/checkout/plan_g4oAakLGDjaoM';
  const REGULAR_CHECKOUT = 'https://whop.com/checkout/plan_wFiqyaojHKXmG';
  const EARLY_BIRD_STATUS_URL = '/api/early-bird-status.json';

  async function refreshEarlyBirdStatus() {
    // Resolve the Pro card FIRST: keying this off the checkout href (as it
    // used to) meant any plan rename silently disabled the whole switch.
    const card =
      document.querySelector('.price-card.popular') || document.querySelector('.price-card');

    if (!card) return;

    const links = card.querySelectorAll('a[href*="whop.com/checkout/"]');
    const hrefOf = (a) => a.getAttribute('href');
    const earlyLink =
      Array.prototype.find.call(links, (a) => hrefOf(a) === EARLY_CHECKOUT) ||
      Array.prototype.find.call(links, (a) => hrefOf(a) !== REGULAR_CHECKOUT) ||
      null;
    let proLink = Array.prototype.find.call(links, (a) => hrefOf(a) === REGULAR_CHECKOUT) || null;

    try {
      const response = await fetch(EARLY_BIRD_STATUS_URL, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) return;

      const status = await response.json();
      if (status.available !== false) return;

      const price = '$' + status.price;
      const label = status.label || 'Regular';
      const cta = 'Get Pro ' + price + ' ' + label;

      // If a Regular CTA is not present on an older localized landing,
      // create one so the sold-out state still has a working purchase path.
      if (!proLink && earlyLink) {
        proLink = document.createElement('a');
        proLink.href = REGULAR_CHECKOUT;
        proLink.target = '_blank';
        proLink.rel = 'noopener noreferrer';
        proLink.className = earlyLink.className.replace('btn-primary', 'btn-secondary');
        earlyLink.insertAdjacentElement('afterend', proLink);
      }

      if (earlyLink) {
        earlyLink.hidden = true;
        earlyLink.setAttribute('aria-hidden', 'true');
      }

      if (proLink) {
        proLink.hidden = false;
        proLink.removeAttribute('aria-hidden');
        proLink.textContent = cta;
      }

      // Update the visible pricing copy inside the Pro card.
      card.querySelectorAll('*').forEach((el) => {
        if (el.children.length !== 0) return;
        // The Early Bird CTA is hidden above: leave its label alone instead of
        // rewriting a control nobody can see.
        if (el === earlyLink) return;
        const text = el.textContent || '';

        // The Early Bird ladder («was $79», «then $79 regular») describes a
        // discount that no longer exists once the phase has moved on: drop it
        // instead of leaving «$ 79» next to a struck-through «$79».
        if (el.classList.contains('price-was') || el.classList.contains('price-sub')) {
          el.remove();
          return;
        }

        if (/Early Bird/i.test(text)) {
          if (el.classList.contains('badge') || el.classList.contains('badge-early')) {
            el.textContent = 'Pro Lifetime v1 — ' + price;
          } else {
            el.textContent = text
              .replace(/Early Bird\s*\(then\s*\$?\d+\)/gi, label)
              .replace(/Early Bird\s*[\u2014-]\s*\d+/gi, label)
              .replace(/Early Bird/gi, label);
          }
        }
        if (/\$\s*59\b/.test(text)) {
          el.textContent = text.replace(/\$\s*59\b/g, '$ ' + status.price);
        }
      });

      card.classList.add('regular-price');
    } catch {
      // Fail closed to the current static Early Bird presentation.
    }
  }

  refreshEarlyBirdStatus();
  window.setInterval(refreshEarlyBirdStatus, 5 * 60 * 1000);

})();