/**
 * ReadScore - Popup Script
 * Handles UI interactions and communication with content script.
 */

// DOM Elements
const initialEl = document.getElementById('initial');
const unsupportedEl = document.getElementById('unsupported');
const startBtnEl = document.getElementById('start-btn');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessageEl = document.getElementById('error-message');
const resultsEl = document.getElementById('results');
const badgeEl = document.getElementById('badge');
const badgeLevelEl = document.getElementById('badge-level');
const readingTimeEl = document.getElementById('reading-time');
const avgSentenceEl = document.getElementById('avg-sentence');
const sentenceCardEl = document.getElementById('sentence-card');
const sentenceQualityEl = document.getElementById('sentence-quality');
const wordCountEl = document.getElementById('word-count');
const wordCountCardEl = document.getElementById('wordcount-card');
const wordCountCategoryEl = document.getElementById('wordcount-category');
const highlightToggleEl = document.getElementById('highlight-toggle');
// Issues section elements
const issuesSummary = document.getElementById('issues-summary');
const complexSentencesCount = document.getElementById('complex-sentences-count');
const complexSentencesBadge = document.getElementById('complex-sentences-badge');
const denseParagraphsCount = document.getElementById('dense-paragraphs-count');
const denseParagraphsBadge = document.getElementById('dense-paragraphs-badge');
const issuesSuccess = document.getElementById('issues-success');
const loadMoreBtn = document.getElementById('load-more-btn');
// Help elements
const helpBtn = document.getElementById('help-btn');
// Selection button
// Selection buttons
const selectionBtn = document.getElementById('selection-btn');
const headerSelectionBtn = document.getElementById('header-selection-btn');

// State
let currentTabId = null;
let analysisResults = null;
// Issue navigation tracking
let currentComplexSentenceIndex = -1;
let currentDenseParagraphIndex = -1;
let highlightOffsets = { complexSentences: 0, denseParagraphs: 0 }; // Synced with content.js

/**
 * Show a specific state (initial, loading, error, or results)
 */
function showState(state) {
    initialEl.classList.toggle('hidden', state !== 'initial');
    unsupportedEl.classList.toggle('hidden', state !== 'unsupported');
    loadingEl.classList.toggle('hidden', state !== 'loading');
    errorEl.classList.toggle('hidden', state !== 'error');
    resultsEl.classList.toggle('hidden', state !== 'results');
    const hideHeaderBtns = state === 'initial' || state === 'error' || state === 'unsupported';
    if (helpBtn) {
        helpBtn.classList.toggle('hidden', hideHeaderBtns);
    }
    if (headerSelectionBtn) {
        headerSelectionBtn.classList.toggle('hidden', hideHeaderBtns);
    }
}

/**
 * Show error message
 */
function showError(message) {
    errorMessageEl.textContent = message;
    showState('error');
}

/**
 * Update UI with analysis results
 */
function updateUI(results) {
    if (results.error) {
        showError(results.error);
        return;
    }

    analysisResults = results;

    // Update badge
    const level = results.level.toLowerCase();
    badgeEl.className = `metric-card ${level}`;
    badgeLevelEl.textContent = results.level;

    // Update metrics
    readingTimeEl.textContent = results.readingTime.formatted;
    avgSentenceEl.textContent = results.avgSentenceLength;

    // Update Grade Label with Descriptive Text
    const gradeLabelEl = document.getElementById('grade-label');
    if (gradeLabelEl && results.grade !== undefined) {
        let educationLevel = '';

        if (results.grade <= 6) {
            educationLevel = 'Basic';
        } else if (results.grade <= 12) {
            educationLevel = 'Average';
        } else {
            educationLevel = 'Advanced';
        }

        gradeLabelEl.textContent = educationLevel;

        // Dynamic coloring for the grade label
        const levelLower = results.level.toLowerCase();
        let bgStyle = '';
        let textStyle = '';

        if (levelLower === 'easy') {
            bgStyle = 'rgba(22, 163, 74, 0.12)';
            textStyle = 'var(--accent-green)';
        } else if (levelLower === 'medium') {
            bgStyle = 'rgba(180, 83, 9, 0.12)';
            textStyle = 'var(--accent-amber)';
        } else {
            bgStyle = 'rgba(220, 38, 38, 0.12)';
            textStyle = 'var(--accent-red)';
        }

        gradeLabelEl.style.background = bgStyle;
        gradeLabelEl.style.color = textStyle;
    }

    // Update sentence quality label and color
    if (results.sentenceQuality) {
        sentenceQualityEl.textContent = results.sentenceQuality.label;
        // Remove old quality classes and add new one
        sentenceCardEl.className = 'metric-card ' + results.sentenceQuality.colorClass;
    }

    wordCountEl.textContent = results.wordCount.toLocaleString();

    // Update word count category label and color
    if (results.wordCountCategory) {
        wordCountCategoryEl.textContent = results.wordCountCategory.label;
        wordCountCardEl.className = 'metric-card ' + results.wordCountCategory.colorClass;
    }

    // Update issues section (with safety check)
    if (results.issues) {
        updateIssuesSection(results.issues);
    }

    // Show/Hide Low Confidence Warning
    const warningEl = document.getElementById('low-confidence-warning');
    if (warningEl) {
        if (results.isLowConfidence) {
            warningEl.classList.remove('hidden');
        } else {
            warningEl.classList.add('hidden');
        }
    }

    showState('results');
}

/**
 * Update the issues section with breakdown and list
 */
function updateIssuesSection(issues) {
    const complexSentencesCnt = issues.complexSentences.length;
    const denseParagraphsCnt = issues.denseParagraphs.length;
    const totalIssues = complexSentencesCnt + denseParagraphsCnt;

    // Update badge counts
    complexSentencesCount.textContent = complexSentencesCnt;
    denseParagraphsCount.textContent = denseParagraphsCnt;

    // Update badge highlighting
    complexSentencesBadge.classList.toggle('has-issues', complexSentencesCnt > 0);
    denseParagraphsBadge.classList.toggle('has-issues', denseParagraphsCnt > 0);

    // Load More button is hidden by default - only shown when highlighting is enabled
    loadMoreBtn.classList.add('hidden');

    // Check if this is a selection analysis (no DOM elements to highlight)
    const isSelectionAnalysis = analysisResults && analysisResults.isSelectionAnalysis;

    // Show success or summary based on issues
    if (totalIssues === 0) {
        issuesSummary.classList.add('hidden');
        issuesSuccess.classList.remove('hidden');
        // Disable toggle when no issues
        highlightToggleEl.disabled = true;
        highlightToggleEl.checked = false;
    } else {
        // Show summary if there are issues (independent of toggle)
        issuesSummary.classList.remove('hidden');
        issuesSuccess.classList.add('hidden');
        // Enable toggle only if NOT a selection analysis
        highlightToggleEl.disabled = isSelectionAnalysis;
        if (isSelectionAnalysis) {
            highlightToggleEl.checked = false;
        }
    }
}

/**
 * Load more highlights
 */
async function loadMoreHighlights() {
    if (!currentTabId || !analysisResults) return;

    // Prevent spamming
    loadMoreBtn.disabled = true;
    loadMoreBtn.style.opacity = '0.5';

    // Process both types
    const types = ['complexSentences', 'denseParagraphs'];
    for (const type of types) {
        try {
            const response = await sendToContentScript({
                action: 'loadMoreHighlights',
                type: type
            });
            if (response && response.nextOffset !== undefined) {
                highlightOffsets[type] = response.nextOffset;
            }
        } catch (e) {
            // Silent fail - highlighting error
        }
    }

    // Re-enable button and check if more available
    loadMoreBtn.style.opacity = '1';
    loadMoreBtn.disabled = false;

    const issues = analysisResults.issues;
    const hasMore = issues.complexSentences.length > highlightOffsets.complexSentences ||
        issues.denseParagraphs.length > highlightOffsets.denseParagraphs;

    if (!hasMore) {
        loadMoreBtn.classList.add('hidden');
    }
}

if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadMoreHighlights);
}

// Help modal toggle
const helpOverlay = document.getElementById('help-overlay');
const helpClose = document.getElementById('help-close');

if (helpBtn && helpOverlay) {
    // Open modal
    helpBtn.addEventListener('click', () => {
        helpOverlay.classList.remove('hidden');
        helpBtn.classList.add('active');
    });

    // Close on X button
    if (helpClose) {
        helpClose.addEventListener('click', () => {
            helpOverlay.classList.add('hidden');
            helpBtn.classList.remove('active');
        });
    }

    // Close on backdrop click
    helpOverlay.addEventListener('click', (e) => {
        if (e.target === helpOverlay) {
            helpOverlay.classList.add('hidden');
            helpBtn.classList.remove('active');
        }
    });

    // Accordion Logic
    const accordionItems = document.querySelectorAll('.help-accordion-item');

    accordionItems.forEach(item => {
        const header = item.querySelector('.help-accordion-header');
        header.addEventListener('click', () => {
            const isOpen = item.classList.contains('open');

            // Close all others
            accordionItems.forEach(otherItem => {
                otherItem.classList.remove('open');
            });

            // Toggle current
            if (!isOpen) {
                item.classList.add('open');
            }
        });
    });
}

/**
 * Scroll to a specific issue on the page
 */
async function scrollToIssue(type, index) {
    if (currentTabId) {
        await sendToContentScript({
            action: 'scrollToIssue',
            issueType: type,
            issueIndex: index
        });
    }
}

/**
 * Inject content script and styles into the current tab
 */
async function injectContentScript(tabId) {
    try {
        // Inject the analyzer first, then content script
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['src/analyzer.js']
        });

        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['src/content.js']
        });

        await chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ['src/styles.css']
        });

        return true;
    } catch (error) {
        // Failed to inject content script
        return false;
    }
}

/**
 * Send message to content script
 */
async function sendToContentScript(message) {
    try {
        const response = await chrome.tabs.sendMessage(currentTabId, message);
        return response;
    } catch (error) {
        // Message send failed
        return null;
    }
}

/**
 * Run analysis on the current page
 */
async function analyzeCurrentPage() {
    showState('loading');

    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
            showError('Unable to access the current tab');
            return;
        }

        // Check if we can run on this page
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.includes('chrome.google.com/webstore') || tab.url.includes('chromewebstore.google.com')) {
            showState('unsupported');
            return;
        }

        currentTabId = tab.id;

        // Inject content script
        const injected = await injectContentScript(currentTabId);
        if (!injected) {
            showError('Unable to analyze this page');
            return;
        }

        // Wait a moment for scripts to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Request analysis
        const results = await sendToContentScript({ action: 'analyze' });

        if (!results) {
            showError('Failed to analyze page content');
            return;
        }

        updateUI(results);

        // Default state: Highlighting OFF for new analysis
        // We do NOT restore from storage here anymore, user must explicitly enable it.
        const hasIssues = results.issues && (results.issues.complexSentences.length + results.issues.denseParagraphs.length) > 0;

        highlightToggleEl.checked = false; // Always start unchecked

        if (!hasIssues) {
            highlightToggleEl.disabled = true;
        } else {
            highlightToggleEl.disabled = false;
        }

    } catch (error) {
        showError('Analysis failed. Please refresh the page. ' + error.message);
    }
}

/**
 * Handle toggle change
 */
async function handleToggleChange(event) {
    const enabled = event.target.checked;

    // Save state
    await chrome.storage.local.set({ highlightEnabled: enabled });

    // Send to content script
    if (currentTabId) {
        sendToContentScript({ action: 'toggleHighlight', enabled: enabled });

        // Sync offsets with content.js - initial batch is 50
        if (enabled && analysisResults) {
            const issues = analysisResults.issues;
            highlightOffsets.complexSentences = Math.min(50, issues.complexSentences.length);
            highlightOffsets.denseParagraphs = Math.min(50, issues.denseParagraphs.length);

            // Update button visibility
            const hasMore = issues.complexSentences.length > highlightOffsets.complexSentences ||
                issues.denseParagraphs.length > highlightOffsets.denseParagraphs;
            loadMoreBtn.classList.toggle('hidden', !hasMore);
        } else {
            // Reset offsets when disabled
            highlightOffsets = { complexSentences: 0, denseParagraphs: 0 };
            loadMoreBtn.classList.add('hidden');
        }
    }
}

/**
 * Analyze selected text from the page
 */
async function analyzeSelection() {
    showState('loading');

    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
            showError('Unable to access the current tab');
            return;
        }

        // Check if we can run on this page
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.includes('chrome.google.com/webstore') || tab.url.includes('chromewebstore.google.com')) {
            showState('unsupported');
            return;
        }

        currentTabId = tab.id;

        // Inject content script first
        const injected = await injectContentScript(currentTabId);
        if (!injected) {
            showError('Unable to access page content');
            return;
        }

        // Wait a moment for scripts to initialize
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get selected text from the page
        const selectionResponse = await sendToContentScript({ action: 'getSelection' });

        if (!selectionResponse || !selectionResponse.selectedText) {
            showError('No text selected. Please select some text on the page first.');
            return;
        }

        const selectedText = selectionResponse.selectedText;

        // Check minimum length (at least 50 characters for meaningful analysis)
        if (selectedText.length < 50) {
            showError('Selection too short. Please select more text for analysis.');
            return;
        }

        // Analyze locally using ReadScoreAnalyzer (already loaded in popup)
        // Split text into paragraphs (by double newlines or single newlines)
        const paragraphs = selectedText
            .split(/\n\s*\n|\n/)
            .map(p => p.trim())
            .filter(p => p.length > 10);

        const results = ReadScoreAnalyzer.analyzeText(selectedText, paragraphs);

        // For selection analysis, we don't have DOM elements to highlight
        // So we disable the highlighting toggle and issues navigation
        results.isSelectionAnalysis = true;

        analysisResults = results;
        updateUI(results);

        // Disable highlighting for selection analysis (no DOM elements)
        highlightToggleEl.checked = false;
        highlightToggleEl.disabled = true;

    } catch (error) {
        showError('Analysis failed: ' + error.message);
    }
}

// Event Listeners
highlightToggleEl.addEventListener('change', handleToggleChange);
startBtnEl.addEventListener('click', analyzeCurrentPage);
if (selectionBtn) {
    selectionBtn.addEventListener('click', analyzeSelection);
}
if (headerSelectionBtn) {
    headerSelectionBtn.addEventListener('click', analyzeSelection);
}

// Badge Navigation Listeners
complexSentencesBadge.addEventListener('click', () => {
    if (!analysisResults || !analysisResults.issues.complexSentences.length) return;

    const total = analysisResults.issues.complexSentences.length;
    const highlightedCount = highlightOffsets.complexSentences;

    // Always navigate within loaded items (start with 50 if none loaded/highlighted)
    // If user loaded 60 items, cycle through 60. If 0 loaded, cycle through first 50.
    const effectiveLimit = Math.max(highlightedCount, 50);
    const limit = Math.min(total, effectiveLimit);

    // Increment index and loop within limit
    currentComplexSentenceIndex = (currentComplexSentenceIndex + 1) % limit;
    scrollToIssue('complexSentence', currentComplexSentenceIndex);

    // Visual feedback
    updateBadgeFeedback(complexSentencesBadge, currentComplexSentenceIndex + 1, limit);
});

denseParagraphsBadge.addEventListener('click', () => {
    if (!analysisResults || !analysisResults.issues.denseParagraphs.length) return;

    const total = analysisResults.issues.denseParagraphs.length;
    const highlightedCount = highlightOffsets.denseParagraphs;

    // Always navigate within loaded items (start with 50 if none loaded/highlighted)
    const effectiveLimit = Math.max(highlightedCount, 50);
    const limit = Math.min(total, effectiveLimit);

    // Increment index and loop within limit
    currentDenseParagraphIndex = (currentDenseParagraphIndex + 1) % limit;
    scrollToIssue('denseParagraph', currentDenseParagraphIndex);

    // Visual feedback
    updateBadgeFeedback(denseParagraphsBadge, currentDenseParagraphIndex + 1, limit);
});

/**
 * Visual feedback for badge click
 */
function updateBadgeFeedback(badgeEl, current, total) {
    // Add active class for animation
    badgeEl.classList.add('badge-active');
    setTimeout(() => badgeEl.classList.remove('badge-active'), 200);

    // Optional: Update text momentarily to show "3 / 18" etc.
    // For now just the click animation is fine
}

/**
 * Initialize popup - check for existing results
 */
async function initializePopup() {
    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
            showState('initial');
            return;
        }

        // Check if we can run on this page
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.includes('chrome.google.com/webstore') || tab.url.includes('chromewebstore.google.com')) {
            showState('unsupported');
            return;
        }

        currentTabId = tab.id;

        // Try to get cached results from content script
        try {
            const cached = await chrome.tabs.sendMessage(currentTabId, { action: 'getCachedResults' });

            // Restore if we have results, regardless of whether highlighting is currently active
            if (cached && cached.hasResults && cached.results) {
                // We have cached results, show them
                updateUI(cached.results);

                // Set toggle based on valid highlighting state from content script
                const totalIssues = (cached.results.issues.complexSentences.length || 0) + (cached.results.issues.denseParagraphs.length || 0);

                if (totalIssues > 0) {
                    highlightToggleEl.checked = cached.isHighlighting;
                    highlightToggleEl.disabled = false;
                } else {
                    highlightToggleEl.checked = false;
                    highlightToggleEl.disabled = true;
                }

                // If highlighting is off, we still want to show the toggle as available (unchecked)
                // If it's on, it will be checked.

                return;
            }
        } catch (e) {
            // Content script not loaded yet, show initial state
        }

        // No cached results, show initial state
        showState('initial');

    } catch (error) {
        // Initialization failed, show initial state
        showState('initial');
    }
}


/**
 * Update version display from manifest
 */
function updateVersionDisplay() {
    const versionEl = document.getElementById('app-version');
    if (versionEl && chrome.runtime && chrome.runtime.getManifest) {
        const manifest = chrome.runtime.getManifest();
        versionEl.textContent = manifest.version;
    }
}

// Initialize on popup open
document.addEventListener('DOMContentLoaded', () => {
    initializePopup();
    updateVersionDisplay();
});
