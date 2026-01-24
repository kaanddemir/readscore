# ReadScore

A Chrome Extension that analyzes the readability of English web pages using transparent, explainable rules—no AI models or external APIs.

![ReadScore Icon](icons/icon128.png)

## Overview

ReadScore helps you assess the complexity of any web page instantly. It calculates readability scores locally in your browser, ensuring completely private analysis without sending data to external servers.

## Features

### Core Analysis
- **Readability Level**: Classifies content as Easy, Medium, or Hard based on the Flesch-Kincaid Grade Level.
- **Estimated Reading Time**: Calculates reading time based on an average speed of 250 WPM.
- **Text Statistics**: Provides word count, sentence count, and average sentence length.

### Visual Highlighting
Toggle visual aids to identifying structural issues directly on the page:
- **Complex Sentences**: Red left border for sentences with excessive clauses (>4).
- **Dense Paragraphs**: Amber left border for long, dense blocks of text (>100 words).

### Privacy Focused
- **Local Processing**: All calculations run inside your browser.
- **No Data Collection**: We do not track websites visited or collect user data.
- **No External Calls**: The extension works entirely offline after installation.
- See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for the full privacy policy.

## Installation

### Manual Installation (Developer Mode)
1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked**.
5. Select the `ReadScore` folder.

## Usage

1. Navigate to any article or blog post.
2. Click the **ReadScore** icon in your browser toolbar to open the popup.
3. Review the readability score and stats.
4. Toggle "Show readability issues" to see complex areas highlighted on the page.

## Project Structure

```text
ReadScore/

├── manifest.json          # Extension configuration
├── PRIVACY_POLICY.md      # Privacy Policy
├── README.md              # Project documentation
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── popup/                 # Popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── src/                   # Core logic
    ├── analyzer.js        # Readability analysis engine
    ├── content.js         # Page content extraction & highlighting
    └── styles.css         # Highlighting styles
```

## Technical Details

ReadScore based its analysis on well-established readability formulas:

**Flesch-Kincaid Grade Level**:
```
0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
```

**Syllable Counting**:
Uses a heuristic vowel-pattern algorithm to estimate syllable counts, accounting for silent 'e's and common exceptions.

## License

Distributed under the MIT License. See `LICENSE` for more information.

## Contact

Created by [HeyKaan.dev](https://heykaan.dev).
