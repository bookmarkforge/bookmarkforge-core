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
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleLangParam);
  } else {
    handleLangParam();
  }

})();