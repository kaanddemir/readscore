/**
 * ReadScore - Easy Read Module
 * Accessibility features for neurodivergent users.
 * All processing happens locally - no AI, no cloud.
 */
'use strict';

if (!window.readScoreEasyReadInitialized) {
  window.readScoreEasyReadInitialized = true;
  const FOCUS_MODE_TRANSITION_MS = 220;
  const TRACKING_ASSIST_TRANSITION_MS = 220;

  const ReadScoreEasyRead = {
    state: {
      focusMode: false,
      simplifiedSpacing: false,
      readingGuide: false,
      // Typography state
      focusFontSize: 18,
      focusLineHeight: 1.6,
      focusLetterSpacing: 0.01,
      // Presets for cycling
      _fsPresets: [16, 18, 20, 24, 28, 32],
      _lhPresets: [1.4, 1.6, 1.8, 2.0, 2.2, 2.4],
      _lsPresets: [0.0, 0.01, 0.02, 0.04, 0.06, 0.08]
    },

    // Storage for reversibility
    _focusOriginals: null,
    _focusCloseHandler: null,
    _focusEscHandler: null,
    _focusCloseTimer: null,
    _focusIsClosing: false,
    _spacingCloseTimer: null,
    _spacingIsClosing: false,
    _rulerHandler: null,
    _rulerElements: [],

    // =====================
    // FOCUS MODE (Reader Overlay)
    // =====================

    _removeFocusModeDOM() {
      const overlay = document.getElementById('readscore-focus-overlay');
      const style = document.getElementById('readscore-focus-styles');
      if (overlay) overlay.remove();
      if (style) style.remove();
    },

    _detachFocusModeListeners() {
      const closeBtn = document.getElementById('readscore-focus-close');
      if (closeBtn && this._focusCloseHandler) {
        closeBtn.removeEventListener('click', this._focusCloseHandler);
      }

      if (this._focusEscHandler) {
        document.removeEventListener('keydown', this._focusEscHandler);
        this._focusEscHandler = null;
      }

      this._focusCloseHandler = null;
    },

    _finalizeFocusModeClose() {
      this._removeFocusModeDOM();

      if (this._focusOriginals) {
        document.body.style.overflow = this._focusOriginals.overflow || '';
      }

      this._detachFocusModeListeners();
      this._focusOriginals = null;
      this._focusCloseTimer = null;
      this._focusIsClosing = false;
      this.state.focusMode = false;
    },

    _removeSimplifiedSpacingDOM() {
      const style = document.getElementById('readscore-spacing-styles');
      const floatBar = document.getElementById('readscore-spacing-floatbar');
      const extraStyle = document.getElementById('readscore-floating-styles');
      if (style) style.remove();
      if (floatBar) floatBar.remove();
      if (extraStyle) extraStyle.remove();
    },

    _finalizeSimplifiedSpacingClose() {
      this._removeSimplifiedSpacingDOM();
      document.body.removeAttribute('data-readscore-spacing');
      this._spacingCloseTimer = null;
      this._spacingIsClosing = false;
      this.state.simplifiedSpacing = false;
    },

    enableFocusMode() {
      if (this.state.focusMode && !this._focusIsClosing) return;

      if (this._focusCloseTimer) {
        window.clearTimeout(this._focusCloseTimer);
        this._focusCloseTimer = null;
      }

      if (this._focusIsClosing) {
        this._removeFocusModeDOM();
        this._detachFocusModeListeners();
        this._focusIsClosing = false;
      } else {
        this._removeFocusModeDOM();
      }

      // Disable Tracking Assist if it was active
      if (this.state.simplifiedSpacing) {
        this.disableSimplifiedSpacing(true);
      }

      // 1) Find the best content source
      const contentSelectors = [
        'article', 'main', '[role="main"]',
        '.post-content', '.article-content', '.entry-content',
        '.content', '.markdown-body', '#content',
        '.post-body', '.story-body', '.article-body',
        '.prose', '.blog-post', '.single-content',
        '[itemprop="articleBody"]'
      ];

      let source = null;
      for (const selector of contentSelectors) {
        source = document.querySelector(selector);
        if (source) break;
      }
      if (!source) source = document.body;

      // 2) Extract readable elements
      const elements = source.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, figure, img, table'
      );

      let contentHTML = '';
      const seenTexts = new Set();

      elements.forEach(el => {
        // Skip hidden elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        // Skip if inside nav, footer, header, aside
        if (el.closest('nav, footer, header, aside, [role="navigation"], [role="banner"]')) return;

        const tag = el.tagName.toLowerCase();
        const text = el.textContent.trim();

        // Skip empty or duplicate
        if (!text && tag !== 'img' && tag !== 'figure') return;
        if (text.length < 10 && !['h1','h2','h3','h4','h5','h6','li'].includes(tag)) return;

        // Dedup
        const textKey = text.slice(0, 80);
        if (seenTexts.has(textKey)) return;
        seenTexts.add(textKey);

        switch (tag) {
          case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
            contentHTML += `<${tag}>${this._sanitize(text)}</${tag}>`;
            break;
          case 'p':
            if (text.length >= 10) {
              contentHTML += `<p>${this._sanitizeHTML(el)}</p>`;
            }
            break;
          case 'ul': case 'ol':
            const items = el.querySelectorAll('li');
            if (items.length > 0) {
              contentHTML += `<${tag}>`;
              items.forEach(li => {
                const liText = li.textContent.trim();
                if (liText.length > 3) {
                  contentHTML += `<li>${this._sanitize(liText)}</li>`;
                }
              });
              contentHTML += `</${tag}>`;
            }
            break;
          case 'blockquote':
            contentHTML += `<blockquote><p>${this._sanitize(text)}</p></blockquote>`;
            break;
          case 'pre':
            contentHTML += `<pre><code>${this._sanitize(el.textContent)}</code></pre>`;
            break;
          case 'img':
            if (el.src && el.naturalWidth > 100 && el.naturalHeight > 100) {
              contentHTML += `<figure><img src="${el.src}" alt="${this._sanitize(el.alt || '')}" />${
                el.alt ? `<figcaption>${this._sanitize(el.alt)}</figcaption>` : ''
              }</figure>`;
            }
            break;
          case 'figure':
            const img = el.querySelector('img');
            const caption = el.querySelector('figcaption');
            if (img && img.src) {
              contentHTML += `<figure><img src="${img.src}" alt="${this._sanitize(img.alt || '')}" />${
                caption ? `<figcaption>${this._sanitize(caption.textContent)}</figcaption>` : ''
              }</figure>`;
            }
            break;
          case 'table':
            contentHTML += `<div class="rs-table-wrap">${el.outerHTML}</div>`;
            break;
        }
      });

      // 3) Create the overlay
      const pageTitle = document.title || '';
      const url = window.location.hostname;

      const overlay = document.createElement('div');
      overlay.id = 'readscore-focus-overlay';
      overlay.innerHTML = `
        <div class="rs-focus-topbar">
          <div class="rs-focus-topbar-inner">
            <div class="rs-focus-left">
              <div class="rs-focus-label-group">
                <div class="rs-focus-label-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                  </svg>
                </div>
                <span class="rs-focus-label">RS Focus Mode</span>
              </div>
            </div>
            
            <div class="rs-focus-domain-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="rs-focus-lock-icon">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span class="rs-focus-domain">${this._sanitize(url)}</span>
            </div>

            <div class="rs-focus-right">
              <button id="readscore-focus-close" class="rs-focus-close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
        <div class="rs-focus-scroll">
          <div class="rs-focus-container">
            <div class="rs-focus-body">
              ${pageTitle ? `<h1 class="rs-focus-page-title">${this._sanitize(pageTitle)}</h1>` : ''}
              ${contentHTML || '<p class="rs-focus-empty">No readable content found on this page.</p>'}
            </div>
          </div>
        </div>

        <div class="rs-focus-subbar" id="rs-focus-adjustments-container">
          <!-- Controls will be injected here -->
        </div>
      `;

      // 4) Inject styles
      const styleEl = document.createElement('style');
      styleEl.id = 'readscore-focus-styles';
      styleEl.textContent = this._getFocusCSS();
      document.head.appendChild(styleEl);

      // 5) Append overlay
      document.body.appendChild(overlay);
      window.requestAnimationFrame(() => {
        overlay.classList.add('rs-focus-visible');
      });

      // 6) Store originals and set body
      if (!this._focusOriginals) {
        this._focusOriginals = {
          overflow: document.body.style.overflow
        };
      }
      document.body.style.overflow = 'hidden';

      // 7) Event Listeners for Adjustments (Cycling)
      // 7) Initialize Adjustments
      this._injectAdjustmentControls(overlay.querySelector('#rs-focus-adjustments-container'), () => {
        const body = overlay.querySelector('.rs-focus-body');
        if (body) {
          body.style.fontSize = `${this.state.focusFontSize}px`;
          body.style.lineHeight = `${this.state.focusLineHeight}`;
          body.style.letterSpacing = `${this.state.focusLetterSpacing}em`;
        }
      });

      // 8) Close handlers
      const closeBtn = document.getElementById('readscore-focus-close');
      if (closeBtn) {
        this._focusCloseHandler = () => this.disableFocusMode();
        closeBtn.addEventListener('click', this._focusCloseHandler);
      }

      this._focusEscHandler = (e) => {
        if (e.key === 'Escape') this.disableFocusMode();
      };
      document.addEventListener('keydown', this._focusEscHandler);

      this.state.focusMode = true;
    },

    disableFocusMode() {
      const overlay = document.getElementById('readscore-focus-overlay');
      this.state.focusMode = false;

      if (!overlay) {
        this._finalizeFocusModeClose();
        return;
      }

      if (this._focusIsClosing) return;

      this._focusIsClosing = true;
      this._detachFocusModeListeners();
      overlay.classList.remove('rs-focus-visible');
      overlay.classList.add('rs-focus-closing');

      this._focusCloseTimer = window.setTimeout(() => {
        this._finalizeFocusModeClose();
      }, FOCUS_MODE_TRANSITION_MS);
    },

    // Sanitize text
    _sanitize(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    // Extract inline HTML (keep bold, italic, links)
    _sanitizeHTML(el) {
      const allowed = ['B', 'STRONG', 'I', 'EM', 'A', 'SPAN', 'CODE', 'BR'];
      const clone = el.cloneNode(true);

      clone.querySelectorAll('*').forEach(child => {
        if (!allowed.includes(child.tagName)) {
          child.replaceWith(...child.childNodes);
        } else if (child.tagName === 'A') {
          // Keep only href
          const href = child.getAttribute('href');
          [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
          if (href) child.setAttribute('href', href);
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener');
        } else {
          // Remove all attributes from other allowed tags
          [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
        }
      });

      return clone.innerHTML;
    },

    // Focus Mode CSS
    _getFocusCSS() {
      return `
        #readscore-focus-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 999999;
          background: #f1f5f9; /* Soft light gray background */
          display: flex;
          flex-direction: column;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 0.22s ease, visibility 0s linear 0.22s;
        }
        #readscore-focus-overlay.rs-focus-visible {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
          transition-delay: 0s;
        }
        #readscore-focus-overlay.rs-focus-closing {
          opacity: 0;
          pointer-events: none;
        }

        /* Top bar with Glassmorphism Overlap */
        .rs-focus-topbar {
          background: rgba(248, 250, 252, 0.4);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(226, 232, 240, 0.4);
          padding: 0 20px;
          flex-shrink: 0;
          position: absolute; /* Changed to absolute to allow overlap */
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
          opacity: 0;
          transform: translateY(-14px);
          transition: opacity 0.22s ease, transform 0.26s ease;
        }
        #readscore-focus-overlay.rs-focus-visible .rs-focus-topbar {
          opacity: 1;
          transform: translateY(0);
        }
        #readscore-focus-overlay.rs-focus-closing .rs-focus-topbar {
          opacity: 0;
          transform: translateY(-14px);
        }
        .rs-focus-topbar-inner {
          max-width: 900px; /* Wider for better balance on large screens */
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 60px;
          gap: 16px;
        }
        .rs-focus-left, .rs-focus-right {
          flex: 1;
          display: flex;
          align-items: center;
        }
        .rs-focus-right {
          justify-content: flex-end;
        }
        .rs-focus-label-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .rs-focus-label-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: rgba(15, 23, 42, 0.05);
          color: #1e293b;
          border-radius: 8px;
        }
        .rs-focus-label-icon svg {
          width: 18px;
          height: 18px;
        }
        .rs-focus-label {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 16px; /* Larger font */
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
        .rs-focus-domain-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(241, 245, 249, 0.8);
          padding: 8px 18px;
          border-radius: 10px;
          border: 1px solid rgba(226, 232, 240, 1);
          max-width: 320px;
          transition: all 0.2s;
        }
        .rs-focus-domain-wrap:hover {
          background: #ffffff;
          border-color: #cbd5e1;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .rs-focus-lock-icon {
          width: 14px;
          height: 14px;
          color: #94a3b8;
          flex-shrink: 0;
        }
        .rs-focus-domain {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          color: #475569;
          font-weight: 600;
          letter-spacing: 0.01em;
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rs-focus-close {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: rgba(241, 245, 249, 0.8);
          border: 1px solid rgba(226, 232, 240, 1);
          color: #475569;
          padding: 8px 18px; /* Increased padding */
          border-radius: 10px; /* Slightly more rounded */
          cursor: pointer;
          font-size: 14px; /* Larger text */
          font-weight: 600;
          transition: all 0.2s ease;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .rs-focus-close svg {
          width: 16px; /* Larger icon */
          height: 16px;
          color: #94a3b8;
        }
        .rs-focus-close:hover {
          background: #ffffff;
          border-color: #cbd5e1;
          color: #0f172a;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .rs-focus-close:hover svg {
          color: #64748b;
        }

        /* Adjustments Sub-bar (Right below topbar) */
        .rs-focus-subbar {
          position: absolute;
          top: 76px; /* Keeps a clearer gap below the topbar */
          left: 50%;
          transform: translate(-50%, -10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(16px) saturate(160%);
          -webkit-backdrop-filter: blur(16px) saturate(160%);
          border: 1px solid rgba(226, 232, 240, 0.9);
          border-radius: 12px;
          padding: 4px 12px;
          box-shadow: 
            0 4px 12px rgba(0, 0, 0, 0.04), 
            0 1px 2px rgba(0, 0, 0, 0.02);
          width: fit-content;
          max-width: calc(100vw - 32px);
          box-sizing: border-box;
          opacity: 0;
          transition: opacity 0.22s ease, transform 0.26s ease;
        }
        #readscore-focus-overlay.rs-focus-visible .rs-focus-subbar {
          opacity: 1;
          transform: translate(-50%, 0);
        }
        #readscore-focus-overlay.rs-focus-closing .rs-focus-subbar {
          opacity: 0;
          transform: translate(-50%, -10px);
        }
        .rs-focus-adjustments {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          flex-wrap: nowrap;
          width: 100%;
        }
        .rs-adj-cycle-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: transparent;
          border: none;
          padding: 6px 12px;
          border-radius: 8px;
          cursor: pointer;
          color: #475569;
          transition: all 0.2s;
          white-space: nowrap; /* Prevent button content from wrapping */
        }
        .rs-adj-cycle-btn:hover {
          background: rgba(59, 130, 246, 0.1);
          color: #2563eb;
        }
        .rs-adj-cycle-btn:active {
          transform: scale(0.95);
        }
        .rs-adj-icon {
          font-size: 16px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .rs-adj-text {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap; /* Prevent label text from wrapping */
        }
        .rs-adj-val {
          font-family: 'SFMono-Regular', Menlo, Monaco, monospace;
          background: rgba(15, 23, 42, 0.06);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          color: #64748b;
          font-weight: 700;
          min-width: 55px;
          text-align: center;
        }
        .rs-adj-reset-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          background: transparent;
          border: none;
          padding: 6px 10px;
          border-radius: 8px;
          cursor: pointer;
          color: #ef4444; /* Alert red for reset */
          transition: all 0.2s;
          opacity: 0.8;
        }
        .rs-adj-reset-btn:hover {
          background: rgba(239, 68, 68, 0.1);
          opacity: 1;
        }
        .rs-adj-reset-btn svg {
          width: 14px;
          height: 14px;
        }
        .rs-focus-adj-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .rs-adj-btn {
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          color: #475569;
          font-size: 10px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 1px 2px rgba(0,0,0,0.02);
        }
        .rs-adj-btn:hover {
          background: #f8fafc;
          border-color: #3b82f6;
          color: #2563eb;
        }
        .rs-adj-btn:active {
          transform: scale(0.95);
        }
        .rs-adj-label {
          font-size: 9px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          min-width: 38px;
          text-align: center;
          letter-spacing: 0.02em;
        }
        .rs-adj-divider {
          width: 1px;
          height: 16px;
          background: rgba(203, 213, 225, 0.6);
          margin: 0;
        }

        /* Scrollable content container */
        .rs-focus-scroll {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding-top: 128px; /* Space for top bar + sub bar + visual gap */
          padding-bottom: 40px;
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.22s ease, transform 0.3s ease;
        }
        #readscore-focus-overlay.rs-focus-visible .rs-focus-scroll {
          opacity: 1;
          transform: translateY(0);
        }
        #readscore-focus-overlay.rs-focus-closing .rs-focus-scroll {
          opacity: 0;
          transform: translateY(16px);
        }
        .rs-focus-container {
          max-width: 680px;
          width: calc(100vw - 48px);
          margin: 40px auto;
          background: #fdfdfd; /* Subtle off-white for reading container */
          padding: clamp(24px, 4vw, 40px) clamp(18px, 5vw, 60px);
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.04);
          border: 1px solid #f1f5f9;
          box-sizing: border-box;
        }

        /* Content typography */
        .rs-focus-body {
          font-family: Georgia, 'Times New Roman', serif;
          color: #1a1a1a;
        }
        .rs-focus-page-title {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 1.8em;
          font-weight: 700;
          line-height: 1.25;
          color: #0f172a;
          margin: 0 0 32px 0;
          padding-bottom: 20px;
          border-bottom: 2px solid #e2e8f0;
        }
        .rs-focus-body h1 {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 1.6em;
          font-weight: 700;
          color: #0f172a;
          margin: 2em 0 0.6em 0;
          line-height: 1.3;
        }
        .rs-focus-body h2 {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 1.4em;
          font-weight: 700;
          color: #0f172a;
          margin: 1.8em 0 0.6em 0;
          line-height: 1.3;
        }
        .rs-focus-body h3 {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 1.2em;
          font-weight: 600;
          color: #1e293b;
          margin: 1.6em 0 0.5em 0;
          line-height: 1.3;
        }
        .rs-focus-body h4, .rs-focus-body h5, .rs-focus-body h6 {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 1.1em;
          font-weight: 600;
          color: #334155;
          margin: 1.4em 0 0.5em 0;
          line-height: 1.3;
        }
        .rs-focus-body p {
          margin: 0 0 1.4em 0;
          color: #1a1a1a;
        }
        .rs-focus-body a {
          color: #2563eb;
          text-decoration: underline;
          text-decoration-color: rgba(37, 99, 235, 0.3);
          text-underline-offset: 3px;
          transition: text-decoration-color 0.15s;
        }
        .rs-focus-body a:hover {
          text-decoration-color: #2563eb;
        }
        .rs-focus-body strong, .rs-focus-body b {
          font-weight: 700;
          color: #0f172a;
        }
        .rs-focus-body em, .rs-focus-body i {
          font-style: italic;
        }
        .rs-focus-body ul, .rs-focus-body ol {
          margin: 0 0 1.4em 0;
          padding-left: 24px;
        }
        .rs-focus-body li {
          margin-bottom: 0.5em;
          line-height: 1.8;
        }
        .rs-focus-body blockquote {
          border-left: 4px solid #cbd5e1;
          padding: 4px 0 4px 20px;
          margin: 1.5em 0;
          color: #475569;
          font-style: italic;
        }
        .rs-focus-body pre {
          background: #f1f5f9;
          padding: 16px 20px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 1.5em 0;
          font-family: 'SFMono-Regular', Menlo, Monaco, 'Courier New', monospace;
          font-size: 14px;
          line-height: 1.6;
          color: #334155;
        }
        .rs-focus-body code {
          background: #f1f5f9;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'SFMono-Regular', Menlo, Monaco, 'Courier New', monospace;
          font-size: 0.85em;
          color: #334155;
        }
        .rs-focus-body pre code {
          background: transparent;
          padding: 0;
          font-size: inherit;
        }
        .rs-focus-body figure {
          margin: 1.5em 0;
          text-align: center;
        }
        .rs-focus-body img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          display: block;
          margin: 0 auto;
        }
        .rs-focus-body figcaption {
          font-size: 14px;
          color: #64748b;
          margin-top: 8px;
          font-style: italic;
        }
        .rs-focus-body table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.5em 0;
          font-size: 16px;
        }
        .rs-focus-body th, .rs-focus-body td {
          border: 1px solid #e2e8f0;
          padding: 10px 14px;
          text-align: left;
        }
        .rs-focus-body th {
          background: #f8fafc;
          font-weight: 600;
        }
        .rs-table-wrap {
          overflow-x: auto;
        }
        .rs-focus-empty {
          color: #94a3b8;
          text-align: center;
          padding: 60px 20px;
          font-style: italic;
        }

        /* Scrollbar */
        .rs-focus-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .rs-focus-scroll::-webkit-scrollbar-track {
          background: #f1f5f9;
        }
        .rs-focus-scroll::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .rs-focus-scroll::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }

        @media (max-width: 860px) {
          .rs-focus-topbar {
            padding: 0 14px;
          }
          .rs-focus-topbar-inner {
            gap: 12px;
          }
          .rs-focus-domain-wrap {
            max-width: 240px;
            padding: 8px 14px;
          }
          .rs-focus-subbar {
            max-width: calc(100vw - 24px);
            padding: 6px 10px;
          }
          .rs-focus-adjustments {
            flex-wrap: nowrap;
            gap: 8px;
          }
          .rs-adj-cycle-btn,
          .rs-adj-reset-btn {
            padding: 6px 10px;
          }
          .rs-adj-text {
            font-size: 12px;
            gap: 5px;
          }
          .rs-adj-val {
            min-width: 48px;
            font-size: 10px;
          }
          .rs-focus-scroll {
            padding-top: 140px;
          }
        }

        @media (max-width: 720px) {
          .rs-focus-adjustments {
            flex-direction: column;
            flex-wrap: nowrap;
            align-items: stretch;
            gap: 8px;
          }
          .rs-adj-divider {
            display: none;
          }
          .rs-adj-cycle-btn,
          .rs-adj-reset-btn {
            flex: none;
            width: 100%;
            min-width: 0;
            justify-content: center;
          }
          .rs-focus-scroll {
            padding-top: 236px;
          }
        }

        @media (max-width: 640px) {
          .rs-focus-topbar-inner {
            height: auto;
            min-height: 60px;
            padding: 10px 0;
            flex-wrap: wrap;
          }
          .rs-focus-left,
          .rs-focus-right {
            flex: 0 0 auto;
          }
          .rs-focus-domain-wrap {
            order: 3;
            width: 100%;
            max-width: none;
            justify-content: center;
          }
          .rs-focus-subbar {
            top: 116px;
            max-width: calc(100vw - 16px);
            padding: 6px;
          }
          .rs-adj-cycle-btn,
          .rs-adj-reset-btn {
            width: 100%;
          }
          .rs-adj-text {
            justify-content: center;
            flex-wrap: wrap;
            text-align: center;
          }
          .rs-focus-scroll {
            padding-top: 268px;
          }
          .rs-focus-container {
            width: calc(100vw - 24px);
            margin: 24px auto;
            border-radius: 14px;
          }
        }
      `;
    },

    // =====================
    // TRACKING ASSIST
    // =====================

    enableSimplifiedSpacing() {
      if (this.state.simplifiedSpacing && !this._spacingIsClosing) return;

      if (this._spacingCloseTimer) {
        window.clearTimeout(this._spacingCloseTimer);
        this._spacingCloseTimer = null;
      }

      if (this._spacingIsClosing) {
        this._removeSimplifiedSpacingDOM();
        this._spacingIsClosing = false;
      } else {
        this._removeSimplifiedSpacingDOM();
      }

      const style = document.createElement('style');
      style.id = 'readscore-spacing-styles';
      style.textContent = `
        :root {
          --rs-p-fs: 18px;
          --rs-p-lh: 1.6;
          --rs-p-ls: 0.01em;
        }
        body[data-readscore-spacing] p:not(.rs-focus-subbar *),
        body[data-readscore-spacing] li:not(.rs-focus-subbar *),
        body[data-readscore-spacing] td:not(.rs-focus-subbar *),
        body[data-readscore-spacing] th:not(.rs-focus-subbar *),
        body[data-readscore-spacing] dd:not(.rs-focus-subbar *),
        body[data-readscore-spacing] blockquote:not(.rs-focus-subbar *),
        body[data-readscore-spacing] figcaption:not(.rs-focus-subbar *),
        body[data-readscore-spacing] pre:not(.rs-focus-subbar *) {
          line-height: var(--rs-p-lh) !important;
          letter-spacing: var(--rs-p-ls) !important;
          font-size: var(--rs-p-fs) !important;
          word-spacing: 0.12em !important;
        }
        body[data-readscore-spacing] p,
        body[data-readscore-spacing] blockquote,
        body[data-readscore-spacing] ul,
        body[data-readscore-spacing] ol,
        body[data-readscore-spacing] pre,
        body[data-readscore-spacing] table,
        body[data-readscore-spacing] figure {
          margin-bottom: 1.8em !important;
        }
        body[data-readscore-spacing] li {
          margin-bottom: 0.6em !important;
        }
      `;
      document.head.appendChild(style);
      document.body.setAttribute('data-readscore-spacing', '');

      // Inject floating adjustment bar for tracking assist
      const floatBar = document.createElement('div');
      floatBar.id = 'readscore-spacing-floatbar';
      floatBar.className = 'rs-focus-subbar rs-floating-mode';
      
      // We need these styles even if Focus Mode style isn't injected yet
      const extraStyle = document.createElement('style');
      extraStyle.id = 'readscore-floating-styles';
      extraStyle.textContent = this._getFocusCSS() + `
        .rs-floating-mode {
          position: fixed !important;
          top: auto !important;
          left: 50% !important;
          right: auto !important;
          bottom: calc(24px + env(safe-area-inset-bottom, 0px)) !important;
          z-index: 100000000 !important;
          opacity: 0 !important;
          transform: translate(-50%, 12px) scale(0.96) !important;
          pointer-events: none !important;
          background: rgba(255, 255, 255, 0.94) !important;
          border-radius: 16px !important;
          box-shadow: 0 18px 42px rgba(15, 23, 42, 0.14), 0 6px 18px rgba(15, 23, 42, 0.08) !important;
          transition: opacity 0.22s ease, transform 0.22s ease !important;
        }
        .rs-floating-mode.rs-floating-visible {
          opacity: 1 !important;
          transform: translate(-50%, 0) scale(1) !important;
          pointer-events: auto !important;
        }
        .rs-floating-mode.rs-floating-closing {
          opacity: 0 !important;
          transform: translate(-50%, 12px) scale(0.96) !important;
          pointer-events: none !important;
        }
      `;
      document.head.appendChild(extraStyle);
      document.body.appendChild(floatBar);
      window.requestAnimationFrame(() => {
        floatBar.classList.add('rs-floating-visible');
      });

      this._injectAdjustmentControls(floatBar, () => {
        document.documentElement.style.setProperty('--rs-p-fs', `${this.state.focusFontSize}px`);
        document.documentElement.style.setProperty('--rs-p-lh', `${this.state.focusLineHeight}`);
        document.documentElement.style.setProperty('--rs-p-ls', `${this.state.focusLetterSpacing}em`);
      });

      this.state.simplifiedSpacing = true;
    },

    disableSimplifiedSpacing(immediate = false) {
      if (!this.state.simplifiedSpacing && !this._spacingIsClosing) return;

      if (this._spacingCloseTimer) {
        window.clearTimeout(this._spacingCloseTimer);
        this._spacingCloseTimer = null;
      }

      const floatBar = document.getElementById('readscore-spacing-floatbar');
      this.state.simplifiedSpacing = false;

      if (immediate || !floatBar) {
        this._finalizeSimplifiedSpacingClose();
        return;
      }

      if (this._spacingIsClosing) return;

      this._spacingIsClosing = true;
      document.body.removeAttribute('data-readscore-spacing');
      floatBar.classList.remove('rs-floating-visible');
      floatBar.classList.add('rs-floating-closing');
      this._spacingCloseTimer = window.setTimeout(() => {
        this._finalizeSimplifiedSpacingClose();
      }, TRACKING_ASSIST_TRANSITION_MS);
    },

    // Helper to inject shared adjustment controls
    _injectAdjustmentControls(container, onUpdate) {
      if (!container) return;
      
      container.innerHTML = `
        <div class="rs-focus-adjustments">
          <button id="rs-adj-fs-cycle" class="rs-adj-cycle-btn">
            <span class="rs-adj-icon">A</span>
            <span class="rs-adj-text">Text Size <span class="rs-adj-val" id="rs-val-fs">18</span></span>
          </button>
          <div class="rs-adj-divider"></div>
          <button id="rs-adj-lh-cycle" class="rs-adj-cycle-btn">
            <span class="rs-adj-icon">↕</span>
            <span class="rs-adj-text">Line Spacing <span class="rs-adj-val" id="rs-val-lh">1.6</span></span>
          </button>
          <div class="rs-adj-divider"></div>
          <button id="rs-adj-ls-cycle" class="rs-adj-cycle-btn">
            <span class="rs-adj-icon">↔</span>
            <span class="rs-adj-text">Letter Spacing <span class="rs-adj-val" id="rs-val-ls">0.01</span></span>
          </button>
          <div class="rs-adj-divider"></div>
          <button id="rs-adj-reset" class="rs-adj-reset-btn" title="Reset to Defaults">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span class="rs-adj-text">Reset</span>
          </button>
        </div>
      `;

      const cycle = (current, presets) => {
        const idx = presets.indexOf(current);
        return presets[(idx + 1) % presets.length];
      };

      const updateLabels = () => {
        const fs = container.querySelector('#rs-val-fs');
        const lh = container.querySelector('#rs-val-lh');
        const ls = container.querySelector('#rs-val-ls');

        if (fs) {
          const fsLabels = { 16: 'Small', 18: 'Standard', 20: 'Medium', 24: 'Large', 28: 'X-Large', 32: 'Huge' };
          fs.textContent = fsLabels[this.state.focusFontSize] || this.state.focusFontSize;
        }

        if (lh) {
          const lhLabels = { 1.4: 'Compact', 1.6: 'Standard', 1.8: 'Loose', 2.0: 'Relaxed', 2.2: 'Wide', 2.4: 'Super' };
          lh.textContent = lhLabels[this.state.focusLineHeight] || this.state.focusLineHeight;
        }

        if (ls) {
          const lsLabels = { 0.0: 'None', 0.01: 'Standard', 0.02: 'Clean', 0.04: 'Wide', 0.06: 'Spacious', 0.08: 'Max' };
          ls.textContent = lsLabels[this.state.focusLetterSpacing] || this.state.focusLetterSpacing;
        }
      };

      container.querySelector('#rs-adj-fs-cycle').addEventListener('click', () => {
        this.state.focusFontSize = cycle(this.state.focusFontSize, this.state._fsPresets);
        updateLabels();
        onUpdate();
      });

      container.querySelector('#rs-adj-lh-cycle').addEventListener('click', () => {
        this.state.focusLineHeight = cycle(this.state.focusLineHeight, this.state._lhPresets);
        updateLabels();
        onUpdate();
      });

      container.querySelector('#rs-adj-ls-cycle').addEventListener('click', () => {
        this.state.focusLetterSpacing = cycle(this.state.focusLetterSpacing, this.state._lsPresets);
        updateLabels();
        onUpdate();
      });

      container.querySelector('#rs-adj-reset').addEventListener('click', () => {
        this.state.focusFontSize = 18;
        this.state.focusLineHeight = 1.6;
        this.state.focusLetterSpacing = 0.01;
        updateLabels();
        onUpdate();
      });

      // Initial update
      updateLabels();
      onUpdate();
    },

    // =====================
    // READING GUIDE
    // =====================

    enableReadingGuide() {
      if (this.state.readingGuide) return;

      const topOverlay = document.createElement('div');
      topOverlay.id = 'readscore-ruler-top';

      const bottomOverlay = document.createElement('div');
      bottomOverlay.id = 'readscore-ruler-bottom';

      const focusStrip = document.createElement('div');
      focusStrip.id = 'readscore-ruler-strip';

      document.body.appendChild(topOverlay);
      document.body.appendChild(bottomOverlay);
      document.body.appendChild(focusStrip);

      this._rulerElements = [topOverlay, bottomOverlay, focusStrip];

      const STRIP_HEIGHT = 50;

      this._rulerHandler = (e) => {
        const y = e.clientY;
        topOverlay.style.height = `${Math.max(0, y - STRIP_HEIGHT / 2)}px`;
        bottomOverlay.style.top = `${y + STRIP_HEIGHT / 2}px`;
        bottomOverlay.style.height = `${Math.max(0, window.innerHeight - y - STRIP_HEIGHT / 2)}px`;
        focusStrip.style.top = `${y - STRIP_HEIGHT / 2}px`;
        focusStrip.style.height = `${STRIP_HEIGHT}px`;
      };

      document.addEventListener('mousemove', this._rulerHandler);
      this.state.readingGuide = true;
    },

    disableReadingGuide() {
      if (!this.state.readingGuide) return;

      if (this._rulerHandler) {
        document.removeEventListener('mousemove', this._rulerHandler);
        this._rulerHandler = null;
      }

      this._rulerElements.forEach(el => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      this._rulerElements = [];
      this.state.readingGuide = false;
    },

    // =====================
    // COMMON
    // =====================

    toggle(feature, enable) {
      switch (feature) {
        case 'focusMode':
          enable ? this.enableFocusMode() : this.disableFocusMode();
          break;
        case 'simplifiedSpacing':
          enable ? this.enableSimplifiedSpacing() : this.disableSimplifiedSpacing();
          break;
        case 'readingGuide':
          enable ? this.enableReadingGuide() : this.disableReadingGuide();
          break;
      }
      return this.state;
    },

    getState() {
      return { ...this.state };
    }
  };

  window.ReadScoreEasyRead = ReadScoreEasyRead;
}
