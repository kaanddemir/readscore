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

const avgSentenceEl = document.getElementById('avg-sentence');
const sentenceCardEl = document.getElementById('sentence-card');
const sentenceQualityEl = document.getElementById('sentence-quality');
const wordCountEl = document.getElementById('word-count');
const wordCountCardEl = document.getElementById('wordcount-card');
const wordCountCategoryEl = document.getElementById('wordcount-category');
// Easy Read elements
const focusModeToggle = document.getElementById('focus-mode-toggle');
const spacingToggle = document.getElementById('spacing-toggle');
const readingGuideToggle = document.getElementById('reading-guide-toggle');
// AI Summary elements
const smartSummarySection = document.getElementById('smart-summary-section');
const aiUnavailable = document.getElementById('ai-unavailable');
const aiReady = document.getElementById('ai-ready');
const aiLoading = document.getElementById('ai-loading');
const aiResult = document.getElementById('ai-result');
const generateSummaryBtn = document.getElementById('generate-summary-btn');
const summarySettingsBtn = document.getElementById('summary-settings-btn');
const aiSettingsPanel = document.getElementById('ai-settings-panel');
const summaryTypeSelect = document.getElementById('summary-type');
const summaryLengthSelect = document.getElementById('summary-length');
const aiRetryBtn = document.getElementById('ai-retry-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const aiResultInfo = document.querySelector('#ai-result .smart-summary-info');
// Help elements
const helpBtn = document.getElementById('help-btn');
// Selection buttons
const selectionBtn = document.getElementById('selection-btn');
const headerSelectionBtn = document.getElementById('header-selection-btn');

// State
let currentTabId = null;
let isGeneratingSummary = false;

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

    if (results.isSelectionAnalysis && results.isLowConfidence) {
        showError('Selection too short. Please select more text for analysis.');
        return;
    }

    // Update badge
    const level = results.level.toLowerCase();
    badgeEl.className = `metric-card ${level}`;
    badgeLevelEl.textContent = results.level;

    // Update metrics

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
        sentenceCardEl.className = 'metric-card ' + results.sentenceQuality.colorClass;
    }

    wordCountEl.textContent = results.wordCount.toLocaleString();

    // Update word count category label and color
    if (results.wordCountCategory) {
        wordCountCategoryEl.textContent = results.wordCountCategory.label;
        wordCountCardEl.className = 'metric-card ' + results.wordCountCategory.colorClass;
    }

    // Disable Easy Read toggles for selection analysis (no DOM elements)
    const isSelection = results.isSelectionAnalysis;
    if (focusModeToggle) focusModeToggle.disabled = !!isSelection;
    if (spacingToggle) spacingToggle.disabled = !!isSelection;
    if (readingGuideToggle) readingGuideToggle.disabled = !!isSelection;

    showState('results');
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

    // Section Toggle Logic
    const helpSections = document.querySelectorAll('.help-section');
    helpSections.forEach(section => {
        const header = section.querySelector('.help-section-header');
        if (header) {
            header.addEventListener('click', () => {
                const isOpen = section.classList.contains('open');

                // Close all others
                helpSections.forEach(otherSection => {
                    otherSection.classList.remove('open');
                });

                // Toggle current
                if (!isOpen) {
                    section.classList.add('open');
                }
            });
        }
    });
}

/**
 * Inject content script and styles into the current tab
 */
async function injectContentScript(tabId) {
    try {
        // Check if script is already running
        try {
            const status = await chrome.tabs.sendMessage(tabId, { action: 'getStatus' });
            if (status) {
                return true; // Already running
            }
        } catch (e) {
            // Script not running, proceed with injection
        }

        // Inject analyzer, then easy read module, then content script
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['src/analyzer.js']
        });

        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['src/easyread.js']
        });

        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['src/content.js']
        });

        await chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ['src/easyread-styles.css']
        });

        return true;
    } catch (error) {
        console.error('Injection failed:', error);
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

    } catch (error) {
        showError('Analysis failed. Please refresh the page. ' + error.message);
    }
}

/**
 * Handle Easy Read toggle change
 */
async function handleEasyReadToggle(feature, enabled) {
    // Save state
    const storageKey = `easyRead_${feature}`;
    await chrome.storage.local.set({ [storageKey]: enabled });

    // Send to content script
    if (currentTabId) {
        await sendToContentScript({
            action: 'toggleEasyRead',
            feature: feature,
            enabled: enabled
        });
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

        // Check minimum length
        if (selectedText.length < 50) {
            showError('Selection too short. Please select more text for analysis.');
            return;
        }

        const results = ReadScoreAnalyzer.analyzeText(selectedText);
        results.isSelectionAnalysis = true;

        updateUI(results);

    } catch (error) {
        showError('Analysis failed: ' + error.message);
    }
}

// Event Listeners
startBtnEl.addEventListener('click', analyzeCurrentPage);
if (selectionBtn) {
    selectionBtn.addEventListener('click', analyzeSelection);
}
if (headerSelectionBtn) {
    headerSelectionBtn.addEventListener('click', analyzeSelection);
}

// Easy Read Toggle Listeners
if (focusModeToggle) {
    focusModeToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        handleEasyReadToggle('focusMode', enabled);
        
        // Disable and UNCHECK spacing toggle based on Focus Mode
        if (spacingToggle) {
            if (enabled && spacingToggle.checked) {
                spacingToggle.checked = false;
                handleEasyReadToggle('simplifiedSpacing', false);
            }
            spacingToggle.disabled = enabled;
            const parent = spacingToggle.closest('.easyread-option');
            if (parent) {
                parent.style.opacity = enabled ? '0.6' : '1';
                parent.style.pointerEvents = enabled ? 'none' : 'auto';
            }
        }
    });
}
if (spacingToggle) {
    spacingToggle.addEventListener('change', (e) => {
        handleEasyReadToggle('simplifiedSpacing', e.target.checked);
    });
}
if (readingGuideToggle) {
    readingGuideToggle.addEventListener('change', (e) => {
        handleEasyReadToggle('readingGuide', e.target.checked);
    });
}

/**
 * Restore Easy Read toggle states from content script
 */
function restoreEasyReadState(easyReadState) {
    if (!easyReadState) return;
    if (focusModeToggle) focusModeToggle.checked = !!easyReadState.focusMode;
    if (spacingToggle) {
        // Ensure spacing toggle reflects focus mode state
        const isFocusMode = focusModeToggle && focusModeToggle.checked;
        
        // If Focus Mode is on, force spacing toggle to be unchecked and disabled
        if (isFocusMode) {
            spacingToggle.checked = false;
            spacingToggle.disabled = true;
        } else {
            spacingToggle.checked = !!easyReadState.simplifiedSpacing;
            spacingToggle.disabled = false;
        }

        const parent = spacingToggle.closest('.easyread-option');
        if (parent) {
            parent.style.opacity = isFocusMode ? '0.6' : '1';
            parent.style.pointerEvents = isFocusMode ? 'none' : 'auto';
        }
    }
    if (readingGuideToggle) readingGuideToggle.checked = !!easyReadState.readingGuide;
}

// ======================
// SMART SUMMARY
// ======================

/**
 * Check if Chrome AI Summarizer is available
 */
async function checkAIAvailability() {
    if (!smartSummarySection) return;

    try {
        // Check if the Summarizer API exists
        if (typeof Summarizer === 'undefined' && typeof self.ai === 'undefined') {
            smartSummarySection.classList.remove('hidden');
            showAIState('unavailable');
            return;
        }

        // Try the standard API
        const SummarizerAPI = (typeof Summarizer !== 'undefined') ? Summarizer : self.ai?.summarizer;

        if (!SummarizerAPI || typeof SummarizerAPI.availability !== 'function') {
            smartSummarySection.classList.remove('hidden');
            showAIState('unavailable');
            return;
        }

        const availability = await SummarizerAPI.availability({ outputLanguage: 'en' });

        smartSummarySection.classList.remove('hidden');

        if (availability === 'available' || availability === 'downloadable') {
            showAIState('ready');
        } else {
            showAIState('unavailable');
        }
    } catch (e) {
        smartSummarySection.classList.remove('hidden');
        showAIState('unavailable');
    }
}

/**
 * Show specific AI state
 */
function showAIState(state) {
    [aiUnavailable, aiReady, aiLoading, aiResult].forEach(el => {
        if (el) el.classList.add('hidden');
    });

    switch (state) {
        case 'unavailable': aiUnavailable?.classList.remove('hidden'); break;
        case 'ready': aiReady?.classList.remove('hidden'); break;
        case 'loading': aiLoading?.classList.remove('hidden'); break;
        case 'result': aiResult?.classList.remove('hidden'); break;
    }
}

function setAIResultStatus(label, tone = 'success') {
    if (!aiResultInfo) return;

    const toneColors = {
        success: 'var(--accent-green)',
        warning: 'var(--accent-amber)',
        error: 'var(--accent-red)',
        muted: 'var(--text-muted)'
    };

    aiResultInfo.textContent = label;
    aiResultInfo.style.color = toneColors[tone] || toneColors.success;
}

function setAISummaryControlsDisabled(disabled) {
    const controls = [generateSummaryBtn, summarySettingsBtn, aiRetryBtn, summaryTypeSelect, summaryLengthSelect];

    controls.forEach(control => {
        if (!control) return;
        control.disabled = disabled;
    });
}

/**
 * Generate summary using Chrome AI
 */
async function generateSummary() {
    if (!currentTabId || isGeneratingSummary) return;

    isGeneratingSummary = true;
    setAISummaryControlsDisabled(true);
    showAIState('loading');

    const type = summaryTypeSelect ? summaryTypeSelect.value : 'key-points';
    const length = summaryLengthSelect ? summaryLengthSelect.value : 'medium';
    let summarizer = null;

    try {
        // Get page text
        const response = await chrome.tabs.sendMessage(currentTabId, { action: 'getPageText' });
        let text = response?.summaryText?.trim() || response?.text?.trim() || '';
        const wordCount = response?.summaryWordCount || response?.wordCount || (text ? text.split(/\s+/).length : 0);

        if (!text || wordCount < 15) {
            setAIResultStatus('Short', 'warning');
            showAIState('result');
            return;
        }

        // Final safeguard only. The content script now tries to send a curated section-aware input.
        const words = text.split(/\s+/);
        if (words.length > 4000) {
            const head = words.slice(0, 2600).join(' ');
            const tail = words.slice(-900).join(' ');
            text = `${head}\n\n[Content gap]\n\n${tail}`;
        }

        // Get the Summarizer API
        const SummarizerAPI = (typeof Summarizer !== 'undefined') ? Summarizer : self.ai?.summarizer;

        if (!SummarizerAPI) {
            setAIResultStatus('Error', 'error');
            showAIState('result');
            return;
        }

        // Create summarizer instance
        summarizer = await SummarizerAPI.create({
            type: type,
            format: 'plain-text',
            length: length,
            outputLanguage: 'en'
        });

        // Generate summary
        const summary = await summarizer.summarize(text);

        // Display result on the page
        const renderResponse = await chrome.tabs.sendMessage(currentTabId, {
            action: 'showSummary',
            summary: summary,
            summaryType: type
        });

        if (!renderResponse || renderResponse.error) {
            throw new Error(renderResponse?.error || 'Unable to show summary');
        }

        setAIResultStatus('Shown', 'success');
        showAIState('result');

    } catch (e) {
        setAIResultStatus('Error', 'error');
        showAIState('result');
    } finally {
        if (summarizer && typeof summarizer.destroy === 'function') {
            try {
                summarizer.destroy();
            } catch (destroyError) {
                // Ignore destroy cleanup errors
            }
        }
        isGeneratingSummary = false;
        setAISummaryControlsDisabled(false);
    }
}

// AI Summary event listeners
if (generateSummaryBtn) {
    generateSummaryBtn.addEventListener('click', () => generateSummary());
}
if (summarySettingsBtn && aiSettingsPanel) {
    summarySettingsBtn.addEventListener('click', () => {
        aiSettingsPanel.classList.remove('hidden');
    });
}
if (closeSettingsBtn && aiSettingsPanel) {
    closeSettingsBtn.addEventListener('click', () => {
        aiSettingsPanel.classList.add('hidden');
    });
}
if (aiSettingsPanel) {
    aiSettingsPanel.addEventListener('click', (e) => {
        if (e.target === aiSettingsPanel) {
            aiSettingsPanel.classList.add('hidden');
        }
    });
}
if (summaryTypeSelect) {
    summaryTypeSelect.addEventListener('change', (e) => {
        chrome.storage.local.set({ rs_summary_type: e.target.value });
    });
}
if (summaryLengthSelect) {
    summaryLengthSelect.addEventListener('change', (e) => {
        const value = e.target.value;
        chrome.storage.local.set({ rs_summary_length: value });
        const warning = document.getElementById('ai-long-warning');
        if (warning) {
            if (value === 'long') {
                warning.classList.remove('hidden');
            } else {
                warning.classList.add('hidden');
            }
        }
    });
}
if (aiRetryBtn) {
    aiRetryBtn.addEventListener('click', () => generateSummary());
}

/**
 * Initialize popup - check for existing results
 */
async function initializePopup() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
            showState('initial');
            return;
        }

        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.includes('chrome.google.com/webstore') || tab.url.includes('chromewebstore.google.com')) {
            showState('unsupported');
            return;
        }

        currentTabId = tab.id;

        // Load saved AI Summary settings
        chrome.storage.local.get(['rs_summary_type', 'rs_summary_length'], (result) => {
            if (result.rs_summary_type && summaryTypeSelect) {
                summaryTypeSelect.value = result.rs_summary_type;
            }
            if (result.rs_summary_length && summaryLengthSelect) {
                summaryLengthSelect.value = result.rs_summary_length;
                if (result.rs_summary_length === 'long') {
                    const warning = document.getElementById('ai-long-warning');
                    if (warning) warning.classList.remove('hidden');
                }
            }
        });

        // Check AI availability
        checkAIAvailability();

        // Try cached results
        try {
            const cached = await chrome.tabs.sendMessage(currentTabId, { action: 'getCachedResults' });

            if (cached && cached.hasResults && cached.results) {
                updateUI(cached.results);
                restoreEasyReadState(cached.easyReadState);
                return;
            }
        } catch (e) {
            // Content script not loaded
        }

        showState('initial');

    } catch (error) {
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
    // Wrap contents for ultra-smooth grid animation
    document.querySelectorAll('.help-section-content').forEach(el => {
        const wrapper = document.createElement('div');
        wrapper.className = 'help-section-content-inner';
        while (el.firstChild) {
            wrapper.appendChild(el.firstChild);
        }
        el.appendChild(wrapper);
    });

    document.querySelectorAll('.help-accordion-content').forEach(el => {
        const wrapper = document.createElement('div');
        wrapper.className = 'help-accordion-content-inner';
        while (el.firstChild) {
            wrapper.appendChild(el.firstChild);
        }
        el.appendChild(wrapper);
    });

    initializePopup();
    updateVersionDisplay();
});
