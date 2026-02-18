# ReadScore

<div align="center">
  <img src="icons/icon128.png" alt="ReadScore Logo" width="128" height="128">
</div>

### Analyze the readability of web pages with transparent, explainable metrics.

## Overview

**ReadScore** is a privacy-first Chrome extension designed to help you understand and improve the readability of any web page. Whether you are a writer looking to refine your content, a student analyzing complex texts, or a developer testing accessibility, ReadScore provides instant, actionable feedback.

Unlike other tools that rely on opaque AI models, ReadScore uses **transparent, rule-based algorithms** to calculate readability scores. It operates entirely within your browser, ensuring that your reading data never leaves your device.

## Features

- **Instant Readability Analysis**: Get immediate scores on reading ease, grade level, and more.
- **Visual Highlighting**: Automatically identifies and highlights:
  - **Complex Sentences**: Long, convoluted structures that may confuse readers.
  - **Dense Paragraphs**: Large blocks of text that can cause visual fatigue.
- **Privacy-First Architecture**: All processing happens locally on your machine. No data is sent to the cloud.
- **Transparent Metrics**: Understand exactly *why* a score was given based on visible rules.

## How It Works

1.  **Extraction**: When you activate ReadScore, it intelligently scans the active tab to identify the main content area (articles, blog posts, etc.), ignoring implementation details like navigation bars and ads.
2.  **Analysis**: The extension runs text through standard readability formulas and custom heuristics to evaluate sentence length, word complexity, and structural density.
3.  **Visualization**: Results are displayed in a clean popup. If you enable highlighting, ReadScore uses the DOM to overlay visual cues directly on the web page, guiding your attention to specific areas that may need improvement.

## Use Cases

-   **Content Creators & Bloggers**: Ensure your articles are accessible and easy to digest for your target audience.
-   **Editors**: Quickly spot run-on sentences and overly dense sections during proofreading.
-   **Students & Researchers**: Gauge the complexity of source materials instantly.
-   **UX Writers**: Verify that interface copy meets readability standards.

## Privacy

ReadScore is built with a **Privacy-First** philosophy.
-   **No Remote Processing**: All text analysis is performed locally in your browser using JavaScript.
-   **No Tracking**: We do not collect your browsing history, personal data, or usage metrics.
-   **No External requests**: The extension never communicates with external servers.

For more details, please see our [Privacy Policy](PRIVACY_POLICY.md).

## Tech Stack

-   **Core**: HTML5, CSS3, Modern JavaScript (ES6+)
-   **Architecture**: Chrome Extension Manifest V3
-   **Analysis Engine**: Custom rule-based algorithms for text processing
-   **Localization**: Chrome i18n API

## Installation

### From Chrome Web Store
[**Install ReadScore**](https://chromewebstore.google.com/detail/readscore/ocklmdaccbpakdjnkhckobkoochkajeg?authuser=0&hl=en)

### Manual Installation (Developer Mode)
1.  Clone this repository.
2.  Open Chrome and go to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right.
4.  Click **Load unpacked**.
5.  Select the directory where you cloned this repository.

## Project Structure

```bash
ReadScore/
├── _locales/          # Localization files (En, Tr)
├── icons/             # Extension application icons
├── popup/             # Popup UI (HTML/CSS/JS)
├── src/               # Core logic (Content scripts, Analyzer)
├── manifest.json      # Extension configuration (Manifest V3)
└── README.md          # Documentation
```

## Roadmap

-   [ ] **Export Reports**: Download analysis results as PDF or JSON.
-   [ ] **Custom Rules**: Allow users to adjust highlighting thresholds.
-   [ ] **History**: Optional local history of analyzed pages.
-   [ ] **Firefox Support**: Port the extension to Firefox Add-ons.

## Contributing

Contributions are welcome! If you have ideas for improvements or new features:

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

## License

Distributed under the MIT License. See `LICENSE` for more information.

<br>

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>
