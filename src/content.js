/**
 * ReadScore - Content Script
 * Extracts page content, runs analysis, and applies highlighting.
 */

if (!window.readScoreInitialized) {
    window.readScoreInitialized = true;

    // State management
    var isHighlightingEnabled = false;
    var analysisResults = null;
    var originalHTML = new Map(); // Store original HTML for restoration

    // Batched highlighting state
    const HIGHLIGHT_BATCH_SIZE = 50;
    let highlightOffsets = {
        complexSentences: 0,
        denseParagraphs: 0
    };

    /**
     * Extract readable text content from the page
     * @returns {Object} - Extracted text and paragraph elements
     */
    function extractPageContent() {
        // Selectors for readable content (ordered by specificity)
        const contentSelectors = [
            'article',
            'main',
            '[role="main"]',
            '.post-content',
            '.article-content',
            '.entry-content',
            '.content',
            // Popular platforms
            '.post-body',           // Blogger
            '.story-body',          // News sites
            '.article-body',        // News sites
            '.markdown-body',       // GitHub
            '.prose',               // Tailwind prose
            '#content',             // Common ID
            '.blog-post',           // Blogs
            '.single-content',      // WordPress themes
            '[itemprop="articleBody"]' // Schema.org
        ];

        // Try to find main content area
        let contentArea = null;
        for (const selector of contentSelectors) {
            contentArea = document.querySelector(selector);
            if (contentArea) break;
        }

        // Fall back to body if no specific content area found
        if (!contentArea) {
            contentArea = document.body;
        }

        // Elements to exclude from analysis
        const excludeSelectors = [
            'script', 'style', 'noscript', 'iframe', 'svg',
            'nav', 'header', 'footer', 'aside',
            '.sidebar', '.menu', '.navigation', '.comments',
            'code', 'pre', '.code', '.highlight'
        ];

        // Get all text-bearing elements
        const paragraphElements = [];
        const textParts = [];

        // Find paragraphs, headings, and list items
        const textElements = contentArea.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');

        textElements.forEach(el => {
            // Skip if element is inside excluded areas
            const isExcluded = excludeSelectors.some(selector => {
                return el.closest(selector) !== null;
            });

            if (isExcluded) return;

            const text = el.textContent.trim();
            if (text.length > 10) { // Skip very short elements
                paragraphElements.push(el);
                textParts.push(text);
            }
        });

        return {
            fullText: textParts.join(' '),
            paragraphs: textParts,
            elements: paragraphElements
        };
    }

    /**
     * Run readability analysis on the page
     * @returns {Object} - Analysis results
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
                    avgSentenceLength: 0,
                    issues: { complexSentences: [], denseParagraphs: [] }
                };
            }

            analysisResults = ReadScoreAnalyzer.analyzeText(content.fullText, content.paragraphs);
            analysisResults.elements = content.elements;
            analysisResults.paragraphs = content.paragraphs;

            return analysisResults;
        } catch (e) {
            return {
                error: 'Analysis failed. Please try again.',
                details: e.message
            };
        }
    }

    /**
     * Escape special regex characters in a string
     * @param {string} string - String to escape
     * @returns {string} - Escaped string
     */
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Apply highlighting to a specific batch of issues
     * @param {string} type - 'longSentences' or 'denseParagraphs'
     * @param {number} startIndex - Start index in issues array
     * @param {number} count - Number of issues to highlight
     */
    function highlightBatch(type, startIndex, count) {
        if (!analysisResults || !analysisResults.elements) return;

        const { issues, elements } = analysisResults;
        const targetIssues = issues[type];

        if (!targetIssues) return { hasMore: false };

        const endIndex = Math.min(startIndex + count, targetIssues.length);
        const batch = targetIssues.slice(startIndex, endIndex);

        batch.forEach(issue => {
            if (type === 'denseParagraphs') {
                // Dense paragraphs have direct index access
                const el = elements[issue.index];
                if (el) {
                    if (!originalHTML.has(el)) originalHTML.set(el, el.innerHTML);
                    el.classList.add('readscore-dense-paragraph');
                }
            } else if (type === 'complexSentences') {
                // Now we have direct paragraph index access!
                // This is 100% reliable as it avoids text matching issues
                const el = elements[issue.paragraphIndex];

                if (el) {
                    // Store original HTML if not already stored
                    if (!originalHTML.has(el)) originalHTML.set(el, el.innerHTML);

                    // Add class to the paragraph
                    el.classList.add('readscore-complex-sentence');
                }
            }
        });

        // Update offsets
        highlightOffsets[type] = endIndex;
        isHighlightingEnabled = true;

        // Return status for popup
        return {
            type,
            nextOffset: endIndex,
            total: targetIssues.length,
            hasMore: endIndex < targetIssues.length
        };
    }

    /**
     * Initial full highlight (starts with first batch)
     */
    function applyHighlighting() {
        // Reset offsets
        highlightOffsets = { complexSentences: 0, denseParagraphs: 0 };

        // Highlight first batch of both types
        highlightBatch('complexSentences', 0, HIGHLIGHT_BATCH_SIZE);
        highlightBatch('denseParagraphs', 0, HIGHLIGHT_BATCH_SIZE);

        isHighlightingEnabled = true;
    }

    /**
     * Remove all highlighting from the page
     */
    function removeHighlighting() {
        // Restore original HTML
        originalHTML.forEach((html, el) => {
            if (document.contains(el)) {
                el.innerHTML = html;
                el.classList.remove('readscore-dense-paragraph');
            }
        });

        // Clear the map to prevent memory leaks
        originalHTML.clear();

        // Reset offsets
        highlightOffsets = { complexSentences: 0, denseParagraphs: 0 };

        // Also remove any remaining classes manually as cleanup
        document.querySelectorAll('.readscore-complex-sentence, .readscore-dense-paragraph').forEach(el => {
            el.classList.remove('readscore-complex-sentence', 'readscore-dense-paragraph');
        });

        isHighlightingEnabled = false;
    }

    /**
     * Toggle highlighting on/off
     * @param {boolean} enable - Whether to enable highlighting
     */
    function toggleHighlighting(enable) {
        if (enable) {
            applyHighlighting();
        } else {
            removeHighlighting();
        }
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
            case 'analyze':
                const results = analyzeCurrentPage();
                // Create a serializable copy of results (exclude DOM elements)
                const serializableResults = { ...results };
                delete serializableResults.elements;
                sendResponse(serializableResults);
                break;

            case 'toggleHighlight':
                toggleHighlighting(message.enabled);
                sendResponse({ success: true, enabled: message.enabled });
                break;

            case 'loadMoreHighlights':
                const { type } = message;
                const offset = highlightOffsets[type];
                const status = highlightBatch(type, offset, HIGHLIGHT_BATCH_SIZE);
                sendResponse(status);
                break;

            case 'getStatus':
                sendResponse({
                    hasResults: analysisResults !== null,
                    isHighlighting: isHighlightingEnabled
                });
                break;

            case 'getCachedResults':
                let cachedData = null;
                if (analysisResults) {
                    cachedData = { ...analysisResults };
                    delete cachedData.elements;
                }

                sendResponse({
                    hasResults: analysisResults !== null,
                    results: cachedData,
                    isHighlighting: isHighlightingEnabled
                });
                break;

            case 'getSelection':
                const selection = window.getSelection();
                const selectedText = selection ? selection.toString().trim() : '';
                sendResponse({ selectedText: selectedText });
                break;

            case 'scrollToIssue':
                if (analysisResults && analysisResults.elements) {
                    let targetElement = null;
                    if (message.issueType === 'complexSentence' && analysisResults.issues.complexSentences[message.issueIndex]) {
                        // Use direct paragraph index for reliability
                        const sentence = analysisResults.issues.complexSentences[message.issueIndex];
                        if (sentence.paragraphIndex !== undefined) {
                            targetElement = analysisResults.elements[sentence.paragraphIndex];
                        } else {
                            // Fallback for safety (though paragraphIndex should exist)
                            const sentenceStart = sentence.text.substring(0, 20);
                            targetElement = analysisResults.elements.find(el =>
                                el.textContent.includes(sentenceStart)
                            );
                        }
                    } else if (message.issueType === 'denseParagraph' && analysisResults.issues.denseParagraphs[message.issueIndex]) {
                        const para = analysisResults.issues.denseParagraphs[message.issueIndex];
                        targetElement = analysisResults.elements[para.index];
                    }

                    if (targetElement) {
                        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Flash effect removed
                    }
                }
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ error: 'Unknown action' });
        }

        return true; // Required for async response
    });
} else {
    // Content script already initialized, skip re-initialization
}
