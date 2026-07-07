/**
 * ReadScore - Content Script
 * Extracts page content and runs analysis.
 */
'use strict';

if (!window.readScoreInitialized) {
    window.readScoreInitialized = true;

    let analysisResults = null;
    let summaryPanelController = null;

    function cleanupSummaryPanel() {
        if (summaryPanelController && typeof summaryPanelController.cleanup === 'function') {
            summaryPanelController.cleanup();
            summaryPanelController = null;
            return;
        }

        const summaryPanel = document.getElementById('readscore-summary-panel');
        const summaryCSS = document.getElementById('readscore-summary-panel-css');
        if (summaryPanel) summaryPanel.remove();
        if (summaryCSS) summaryCSS.remove();
    }

    const CONTENT_CANDIDATE_SELECTORS = [
        'article', 'main', '[role="main"]',
        '.post-content', '.article-content', '.entry-content',
        '.content', '.post-body', '.story-body', '.article-body',
        '.markdown-body', '.prose', '#content',
        '.blog-post', '.single-content', '[itemprop="articleBody"]'
    ];

    const CONTENT_BLOCK_SELECTOR = 'h1, h2, h3, p, li, blockquote';

    const EXCLUDE_SELECTORS = [
        'script', 'style', 'noscript', 'iframe', 'svg',
        'nav', 'header', 'footer', 'aside',
        'code', 'pre', '.code', '.highlight',
        '[contenteditable="true"]', 'textarea', 'input'
    ];

    const NOISE_KEYWORDS = [
        'sidebar', 'menu', 'navigation', 'comment', 'share', 'social',
        'cookie', 'banner', 'popup', 'modal', 'newsletter', 'subscribe',
        'breadcrumb', 'related', 'recommend', 'promo', 'advert', 'ads',
        'toolbar', 'footer', 'header', 'hero', 'rail'
    ];

    const CONTENT_KEYWORDS = [
        'article', 'content', 'main', 'post', 'entry',
        'story', 'body', 'markdown', 'prose', 'reader'
    ];

    function normalizeText(text) {
        return (text || '')
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getWordCount(text) {
        const normalized = normalizeText(text);
        return normalized ? normalized.split(/\s+/).length : 0;
    }

    function getElementDescriptor(el) {
        const className = typeof el.className === 'string' ? el.className : '';
        return `${el.id || ''} ${className}`.toLowerCase();
    }

    function hasKeyword(value, keywords) {
        return keywords.some(keyword => value.includes(keyword));
    }

    function isElementVisible(el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        return el.getAttribute('aria-hidden') !== 'true';
    }

    function isNoiseElement(el) {
        if (EXCLUDE_SELECTORS.some(selector => el.closest(selector) !== null)) {
            return true;
        }

        let current = el;
        while (current && current !== document.body) {
            const descriptor = getElementDescriptor(current);
            if (descriptor && hasKeyword(descriptor, NOISE_KEYWORDS) && !hasKeyword(descriptor, CONTENT_KEYWORDS)) {
                return true;
            }
            current = current.parentElement;
        }

        return false;
    }

    function scoreContentCandidate(el) {
        const descriptor = getElementDescriptor(el);
        const textLength = normalizeText(el.innerText || el.textContent || '').length;

        if (textLength < 120) {
            return Number.NEGATIVE_INFINITY;
        }

        const paragraphCount = el.querySelectorAll('p').length;
        const listItemCount = el.querySelectorAll('li').length;
        const headingCount = el.querySelectorAll('h1, h2, h3').length;

        let score = Math.min(textLength, 12000) / 30;
        score += paragraphCount * 25;
        score += Math.min(listItemCount, 20) * 8;
        score += headingCount * 12;

        const tagName = el.tagName.toLowerCase();
        if (tagName === 'article') score += 220;
        if (tagName === 'main') score += 180;
        if (el.getAttribute('role') === 'main') score += 140;
        if (hasKeyword(descriptor, CONTENT_KEYWORDS)) score += 80;
        if (hasKeyword(descriptor, NOISE_KEYWORDS)) score -= 120;
        if (el === document.body) score -= 400;

        return score;
    }

    function getBestContentRoot() {
        const candidates = new Set();

        CONTENT_CANDIDATE_SELECTORS.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => candidates.add(el));
        });

        candidates.add(document.body);

        let bestCandidate = document.body;
        let bestScore = Number.NEGATIVE_INFINITY;

        candidates.forEach(candidate => {
            const score = scoreContentCandidate(candidate);
            if (score > bestScore) {
                bestScore = score;
                bestCandidate = candidate;
            }
        });

        return bestCandidate || document.body;
    }

    function trimSectionText(text, maxWords) {
        const words = normalizeText(text).split(/\s+/).filter(Boolean);
        if (words.length <= maxWords) {
            return words.join(' ');
        }

        const headCount = Math.max(1, Math.ceil(maxWords * 0.7));
        const tailCount = Math.max(0, maxWords - headCount);
        const head = words.slice(0, headCount).join(' ');
        const tail = tailCount > 0 ? words.slice(-tailCount).join(' ') : '';

        return tail ? `${head} ... ${tail}` : head;
    }

    function scoreSummarySection(section, index, totalSections) {
        const heading = (section.heading || '').toLowerCase();
        let score = section.wordCount;

        if (section.hasHeading) score += 25;
        if (index === 0) score += 35;
        if (index === totalSections - 1) score += 8;
        if (/introduction|overview|background|summary/.test(heading)) score += 20;
        if (/conclusion|takeaway|final|closing|results|outcome/.test(heading)) score += 24;
        if (/related|share|comment|promo|advert|sponsor/.test(heading)) score -= 40;
        if (section.wordCount < 30) score -= 18;

        return score;
    }

    function buildSummaryInput(title, blocks, fallbackText) {
        const sections = [];
        let currentSection = {
            heading: 'Introduction',
            hasHeading: false,
            textParts: [],
            wordCount: 0
        };

        function pushCurrentSection() {
            if (!currentSection.textParts.length) return;
            sections.push({
                heading: currentSection.heading,
                hasHeading: currentSection.hasHeading,
                text: currentSection.textParts.join('\n\n'),
                wordCount: currentSection.wordCount
            });
        }

        blocks.forEach(block => {
            if (block.type === 'heading') {
                pushCurrentSection();
                currentSection = {
                    heading: block.text,
                    hasHeading: true,
                    textParts: [],
                    wordCount: 0
                };
                return;
            }

            currentSection.textParts.push(block.text);
            currentSection.wordCount += block.wordCount;
        });

        pushCurrentSection();

        if (!sections.length) {
            return fallbackText;
        }

        const wordBudget = 1400;
        const targetSectionCount = Math.min(sections.length, sections.length >= 4 ? 4 : 3);
        const selectedIndexes = new Set();
        const selectedSections = [];
        let usedWords = 0;

        function addSection(index) {
            if (index < 0 || index >= sections.length || selectedIndexes.has(index)) return;

            const section = sections[index];
            const isEdgeSection = index === 0 || index === sections.length - 1;
            const maxWords = isEdgeSection ? 140 : 180;
            const trimmedText = trimSectionText(section.text, maxWords);
            const trimmedWords = getWordCount(trimmedText);

            if (usedWords + trimmedWords > wordBudget && selectedIndexes.size > 0) {
                return;
            }

            selectedIndexes.add(index);
            selectedSections.push({
                index,
                heading: section.heading,
                text: trimmedText
            });
            usedWords += trimmedWords;
        }

        addSection(0);

        const conclusionIndex = [...sections.keys()].reverse().find(index => (
            index !== 0 &&
            /conclusion|takeaway|final|closing|results|outcome/.test((sections[index].heading || '').toLowerCase())
        ));
        if (conclusionIndex !== undefined) {
            addSection(conclusionIndex);
        }

        const rankedSections = sections
            .map((section, index) => ({
                index,
                score: scoreSummarySection(section, index, sections.length),
                section
            }))
            .filter(item => !selectedIndexes.has(item.index) && item.section.wordCount >= 25)
            .sort((a, b) => b.score - a.score);

        for (const item of rankedSections) {
            if (selectedIndexes.size >= targetSectionCount || usedWords >= wordBudget * 0.9) {
                break;
            }
            addSection(item.index);
        }

        if (selectedIndexes.size < targetSectionCount) {
            sections.forEach((section, index) => {
                if (selectedIndexes.size >= targetSectionCount) return;
                addSection(index);
            });
        }

        selectedSections.sort((a, b) => a.index - b.index);

        const parts = [];
        const normalizedTitle = normalizeText(title);
        const usedHeadingKeys = new Set();

        if (normalizedTitle) {
            parts.push(`# ${normalizedTitle}`);
        }

        selectedSections.forEach(section => {
            let displayHeading = section.heading || 'Section';
            if (normalizeText(displayHeading).toLowerCase() === normalizedTitle.toLowerCase()) {
                displayHeading = 'Introduction';
            }

            const headingKey = normalizeText(displayHeading).toLowerCase();
            if (headingKey && !usedHeadingKeys.has(headingKey)) {
                parts.push(`## ${displayHeading}`);
                usedHeadingKeys.add(headingKey);
            }
            parts.push(section.text);
        });

        const summaryInput = parts.join('\n\n').trim();
        return summaryInput || fallbackText;
    }

    /**
     * Extract readable text content from the page
     */
    function extractPageContent() {
        const contentArea = getBestContentRoot();
        const blocks = [];
        const seenText = new Set();

        contentArea.querySelectorAll(CONTENT_BLOCK_SELECTOR).forEach(el => {
            if (!isElementVisible(el) || isNoiseElement(el)) {
                return;
            }

            const isHeading = /^H[1-3]$/.test(el.tagName);
            const text = normalizeText(el.textContent);
            const wordCount = getWordCount(text);
            const minimumWords = isHeading ? 1 : (el.tagName === 'LI' ? 4 : 6);
            const minimumLength = isHeading ? 3 : (el.tagName === 'LI' ? 18 : 24);

            if (!text || wordCount < minimumWords || text.length < minimumLength) {
                return;
            }

            const textKey = text.toLowerCase();
            if (seenText.has(textKey)) {
                return;
            }
            seenText.add(textKey);

            blocks.push({
                type: isHeading ? 'heading' : 'text',
                text,
                wordCount
            });
        });

        const fullText = blocks
            .filter(block => block.type !== 'heading')
            .map(block => block.text)
            .join(' ');
        const summaryText = buildSummaryInput(document.title, blocks, fullText);

        return {
            fullText,
            summaryText,
            summaryWordCount: getWordCount(summaryText)
        };
    }

    /**
     * Run readability analysis on the page
     */
    function analyzeCurrentPage() {
        try {
            const content = extractPageContent();

            if (content.fullText.length < 50) {
                return {
                    error: 'Not enough text content to analyze',
                    level: 'N/A',
                    readingTime: { formatted: 'N/A' },
                    wordCount: 0,
                    sentenceCount: 0,
                    avgSentenceLength: 0
                };
            }

            analysisResults = ReadScoreAnalyzer.analyzeText(content.fullText);
            return analysisResults;
        } catch (e) {
            return { error: 'Analysis failed. Please try again.', details: e.message };
        }
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
            case 'analyze':
                const results = analyzeCurrentPage();
                sendResponse(results);
                break;

            case 'getStatus':
                sendResponse({ hasResults: analysisResults !== null });
                break;

            case 'getCachedResults':
                sendResponse({
                    hasResults: analysisResults !== null,
                    results: analysisResults,
                    easyReadState: window.ReadScoreEasyRead ? window.ReadScoreEasyRead.getState() : null
                });
                break;

            case 'getSelection':
                const selection = window.getSelection();
                sendResponse({ selectedText: selection ? selection.toString().trim() : '' });
                break;

            case 'getPageText':
                const pageContent = extractPageContent();
                sendResponse({
                    text: pageContent.fullText,
                    wordCount: pageContent.fullText.trim() ? pageContent.fullText.trim().split(/\s+/).length : 0,
                    summaryText: pageContent.summaryText,
                    summaryWordCount: pageContent.summaryWordCount
                });
                break;

            case 'showSummary':
                cleanupSummaryPanel();

                // Inject styles
                const panelCSS = document.createElement('style');
                panelCSS.id = 'readscore-summary-panel-css';
                panelCSS.textContent = `
                    #readscore-summary-panel {
                        position: fixed;
                        width: 400px;
                        height: auto;
                        background: #ffffff;
                        border-radius: 12px;
                        border: 1px solid #e2e8f0;
                        box-shadow: 0 12px 48px rgba(0,0,0,0.12);
                        z-index: 999998;
                        display: flex;
                        flex-direction: column;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        animation: rsSummarySlideIn 0.3s ease-out;
                        /* Prevent selection when dragging */
                        user-select: none;
                        min-width: 250px;
                        min-height: 140px;
                        max-width: 90vw;
                        max-height: 90vh;
                    }
                    /* Custom Resizers */
                    .rs-resizer {
                        position: absolute;
                        background: transparent;
                        z-index: 999999;
                    }
                    .rs-resizer-t { top: -5px; left: 0; right: 0; height: 10px; cursor: ns-resize; }
                    .rs-resizer-r { top: 0; right: -5px; bottom: 0; width: 10px; cursor: ew-resize; }
                    .rs-resizer-b { bottom: -5px; left: 0; right: 0; height: 10px; cursor: ns-resize; }
                    .rs-resizer-l { top: 0; left: -5px; bottom: 0; width: 10px; cursor: ew-resize; }
                    .rs-resizer-nw { top: -5px; left: -5px; width: 10px; height: 10px; cursor: nwse-resize; }
                    .rs-resizer-ne { top: -5px; right: -5px; width: 10px; height: 10px; cursor: nesw-resize; }
                    .rs-resizer-sw { bottom: -5px; left: -5px; width: 10px; height: 10px; cursor: nesw-resize; }
                    .rs-resizer-se { bottom: -5px; right: -5px; width: 10px; height: 10px; cursor: nwse-resize; }
                    @keyframes rsSummarySlideIn {
                        from { opacity: 0; transform: translateY(20px) scale(0.95); }
                        to { opacity: 1; transform: translateY(0) scale(1); }
                    }
                    .rs-summary-header {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        padding: 14px 18px;
                        background: #f8fafc;
                        border-bottom: 1px solid #f1f5f9;
                        border-radius: 12px 12px 0 0;
                        color: #0f172a;
                        cursor: grab;
                    }
                    .rs-summary-header:active {
                        cursor: grabbing;
                    }
                    .rs-summary-header-left {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    .rs-summary-icon {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 26px;
                        height: 26px;
                        background: rgba(59, 130, 246, 0.1);
                        color: #3b82f6;
                        border-radius: 6px;
                    }
                    .rs-summary-icon svg {
                        width: 14px;
                        height: 14px;
                    }
                    .rs-summary-header-title {
                        font-size: 14px;
                        font-weight: 600;
                    }
                    .rs-summary-close {
                        background: transparent;
                        border: none;
                        color: #94a3b8;
                        width: 28px;
                        height: 28px;
                        border-radius: 6px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.15s;
                    }
                    .rs-summary-close svg {
                        width: 16px;
                        height: 16px;
                    }
                    .rs-summary-close:hover {
                        background: #f1f5f9;
                        color: #475569;
                    }
                    .rs-summary-scroll {
                        flex: 1 1 auto;
                        min-height: 0;
                        overflow-y: auto;
                        padding: 20px;
                        user-select: text; /* Allow user to select the generated text */
                    }
                    .rs-summary-text {
                        font-size: 14px;
                        line-height: 1.6;
                        color: #1e293b;
                        white-space: pre-wrap;
                        word-wrap: break-word;
                    }
                    .rs-summary-scroll::-webkit-scrollbar { width: 6px; }
                    .rs-summary-scroll::-webkit-scrollbar-track { background: transparent; }
                    .rs-summary-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
                `;
                document.head.appendChild(panelCSS);

                // Create panel
                const panel = document.createElement('div');
                panel.id = 'readscore-summary-panel';
                panel.innerHTML = `
                    <div class="rs-resizer rs-resizer-t"></div>
                    <div class="rs-resizer rs-resizer-r"></div>
                    <div class="rs-resizer rs-resizer-b"></div>
                    <div class="rs-resizer rs-resizer-l"></div>
                    <div class="rs-resizer rs-resizer-nw"></div>
                    <div class="rs-resizer rs-resizer-ne"></div>
                    <div class="rs-resizer rs-resizer-sw"></div>
                    <div class="rs-resizer rs-resizer-se"></div>
                    <div class="rs-summary-header" id="rs-summary-drag-handle">
                        <div class="rs-summary-header-left">
                            <div class="rs-summary-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 2L15 9l7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"/>
                                </svg>
                            </div>
                            <span class="rs-summary-header-title">AI Summary</span>
                        </div>
                        <button class="rs-summary-close" id="rs-summary-close-btn" aria-label="Close">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="rs-summary-scroll">
                        <div class="rs-summary-text"></div>
                    </div>
                `;
                document.body.appendChild(panel);

                const MIN_WIDTH = 250;
                const MIN_HEIGHT = 140;
                const VIEWPORT_MARGIN = 20;
                const listenerCleanups = [];
                let activeResizeCleanup = null;
                let cleanedUp = false;
                let panelRect = null;

                function getPanelSizeLimits() {
                    return {
                        maxWidth: Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.9)),
                        maxHeight: Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * 0.9))
                    };
                }

                function clamp(value, min, max) {
                    return Math.min(Math.max(value, min), max);
                }

                function applyPanelRect(nextRect) {
                    const { maxWidth, maxHeight } = getPanelSizeLimits();
                    const width = clamp(nextRect.width, MIN_WIDTH, maxWidth);
                    const height = clamp(nextRect.height, MIN_HEIGHT, maxHeight);
                    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
                    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
                    const left = clamp(nextRect.left, VIEWPORT_MARGIN, maxLeft);
                    const top = clamp(nextRect.top, VIEWPORT_MARGIN, maxTop);

                    panelRect = { left, top, width, height };
                    panel.style.left = `${left}px`;
                    panel.style.top = `${top}px`;
                    panel.style.width = `${width}px`;
                    panel.style.height = `${height}px`;
                    panel.style.right = 'auto';
                    panel.style.bottom = 'auto';
                    panel.style.transform = 'none';
                }

                function getInitialPanelRect() {
                    const scrollEl = panel.querySelector('.rs-summary-scroll');
                    const measuredWidth = panel.offsetWidth || 400;
                    const chromeHeight = Math.max(0, panel.offsetHeight - scrollEl.offsetHeight);
                    const desiredHeight = chromeHeight + scrollEl.scrollHeight;

                    return {
                        left: window.innerWidth - measuredWidth - VIEWPORT_MARGIN,
                        top: window.innerHeight - desiredHeight - VIEWPORT_MARGIN,
                        width: measuredWidth,
                        height: desiredHeight
                    };
                }

                function cleanupPanel() {
                    if (cleanedUp) return;
                    cleanedUp = true;

                    if (activeResizeCleanup) {
                        activeResizeCleanup();
                        activeResizeCleanup = null;
                    }

                    listenerCleanups.forEach(cleanup => cleanup());
                    listenerCleanups.length = 0;

                    panel.remove();
                    panelCSS.remove();

                    if (summaryPanelController && summaryPanelController.cleanup === cleanupPanel) {
                        summaryPanelController = null;
                    }
                }

                summaryPanelController = { cleanup: cleanupPanel };

                // Set text before measuring the first rect so the panel opens closer to the actual content size.
                const summaryText = panel.querySelector('.rs-summary-text');
                const formatted = message.summary
                    .replace(/^[\*\-]\s/gm, '• ')
                    .trim();

                summaryText.textContent = formatted;

                applyPanelRect(getInitialPanelRect());

                const handleViewportResize = () => {
                    if (panelRect) {
                        applyPanelRect(panelRect);
                    }
                };
                window.addEventListener('resize', handleViewportResize);
                listenerCleanups.push(() => window.removeEventListener('resize', handleViewportResize));

                // Resize logic
                const resizers = panel.querySelectorAll('.rs-resizer');
                let isResizing = false;

                resizers.forEach(resizer => {
                    const resizeStart = (e) => {
                        e.preventDefault();
                        isResizing = true;
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const startRect = {
                            ...panelRect,
                            right: panelRect.left + panelRect.width,
                            bottom: panelRect.top + panelRect.height
                        };
                        const direction = resizer.classList[1].split('-')[2];

                        function mouseMove(e) {
                            if (!isResizing) return;

                            const dx = e.clientX - startX;
                            const dy = e.clientY - startY;
                            const { maxWidth, maxHeight } = getPanelSizeLimits();
                            const nextRect = { ...startRect };

                            if (direction.includes('r')) {
                                nextRect.width = clamp(startRect.width + dx, MIN_WIDTH, maxWidth);
                            }
                            if (direction.includes('b')) {
                                nextRect.height = clamp(startRect.height + dy, MIN_HEIGHT, maxHeight);
                            }
                            if (direction.includes('l')) {
                                nextRect.width = clamp(startRect.width - dx, MIN_WIDTH, maxWidth);
                                nextRect.left = startRect.right - nextRect.width;
                            }
                            if (direction.includes('t')) {
                                nextRect.height = clamp(startRect.height - dy, MIN_HEIGHT, maxHeight);
                                nextRect.top = startRect.bottom - nextRect.height;
                            }

                            applyPanelRect(nextRect);
                        }

                        function mouseUp() {
                            if (activeResizeCleanup) {
                                activeResizeCleanup();
                                activeResizeCleanup = null;
                            }
                        }

                        if (activeResizeCleanup) {
                            activeResizeCleanup();
                        }

                        activeResizeCleanup = () => {
                            isResizing = false;
                            window.removeEventListener('mousemove', mouseMove);
                            window.removeEventListener('mouseup', mouseUp);
                        };

                        window.addEventListener('mousemove', mouseMove);
                        window.addEventListener('mouseup', mouseUp);
                    };

                    resizer.addEventListener('mousedown', resizeStart);
                    listenerCleanups.push(() => resizer.removeEventListener('mousedown', resizeStart));
                });

                // Draggable logic
                const dragHandle = panel.querySelector('#rs-summary-drag-handle');
                let isDragging = false;
                let dragSession = null;

                function dragStart(e) {
                    if (e.target.closest('#rs-summary-close-btn')) return;
                    if (isResizing) return;
                    dragSession = {
                        startX: e.clientX,
                        startY: e.clientY,
                        startLeft: panelRect.left,
                        startTop: panelRect.top
                    };
                    isDragging = true;
                }

                function dragEnd() {
                    if (!isDragging) return;
                    isDragging = false;
                    dragSession = null;
                }

                function drag(e) {
                    if (!isDragging || !dragSession) return;

                    e.preventDefault();
                    panel.style.animation = 'none';
                    applyPanelRect({
                        left: dragSession.startLeft + (e.clientX - dragSession.startX),
                        top: dragSession.startTop + (e.clientY - dragSession.startY),
                        width: panelRect.width,
                        height: panelRect.height
                    });
                }

                dragHandle.addEventListener('mousedown', dragStart);
                document.addEventListener('mouseup', dragEnd);
                document.addEventListener('mousemove', drag);
                listenerCleanups.push(() => dragHandle.removeEventListener('mousedown', dragStart));
                listenerCleanups.push(() => document.removeEventListener('mouseup', dragEnd));
                listenerCleanups.push(() => document.removeEventListener('mousemove', drag));

                // Close button
                const closeButton = panel.querySelector('#rs-summary-close-btn');
                const handleClose = () => cleanupPanel();
                closeButton.addEventListener('click', handleClose);
                listenerCleanups.push(() => closeButton.removeEventListener('click', handleClose));

                sendResponse({ success: true });
                break;

            case 'toggleEasyRead':
                if (window.ReadScoreEasyRead) {
                    const erState = window.ReadScoreEasyRead.toggle(message.feature, message.enabled);
                    sendResponse({ success: true, state: erState });
                } else {
                    sendResponse({ error: 'Easy Read not available' });
                }
                break;

            default:
                sendResponse({ error: 'Unknown action' });
        }

        return true;
    });
}
