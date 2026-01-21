# ReadScore

A privacy-first Chrome Extension that analyzes the readability of English web pages using transparent, explainable rules—no AI models or external APIs.

![ReadScore Banner](icons/icon128.png)

## Features

### Core Metrics
- **Readability Level**: Easy / Medium / Hard classification (using Flesch-Kincaid Grade Level)
- **Estimated Reading Time**: Research-backed speed (250 WPM average adult reading speed)
- **Average Sentence Length**: Words per sentence with quality rating
- **Total Words**: Word count with category classification

### Visual Highlighting
When highlighting is enabled:
- **Complex sentences** (>4 clauses) — Red left border
- **Dense paragraphs** (>100 words) — Amber left border

## How It Works

ReadScore uses transparent, research-backed analysis:

### Flesch-Kincaid Grade Level
```
Grade = 0.39 × (words/sentences) + 11.8 × (syllables/words) − 15.59
```

| FK Grade | Level | Audience |
|----------|-------|----------|
| 0-6 | Easy | Basic |
| 7-12 | Medium | Average |
| 13+ | Hard | Advanced |

> **Note on Reliability:** For texts shorter than 100 words, ReadScore automatically defaults to a confidence-adjusted rating to avoid misleading extreme scores due to insufficient data.

### Reading Speed (Research-Backed)
| Content | Words Per Minute |
|---------|------------------|
| Easy | 275 WPM |
| Medium | 250 WPM (adult average) |
| Hard | 200 WPM |

## Privacy First

- All analysis runs **locally in your browser**
- **No data collection** or tracking
- **No external API calls**
- **No AI models** — just simple, explainable rules
- Only activates when you click the extension icon

## Installation

### From Chrome Web Store
*(Coming Soon)*

### Manual Installation (Developer Mode)
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `ReadScore` folder

## Usage

1. Navigate to any web page with English text
2. Click the ReadScore icon in your browser toolbar
3. View your readability metrics instantly
4. Toggle "Show readability issues" to highlight problems on the page

## Project Structure

```
ReadScore/
├── manifest.json          # Extension configuration
├── PRIVACY_POLICY.md    # Privacy Policy
├── README.md              # This file
├── icons/                 # Extension icons
│   ├── icon16.png
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

### Syllable Counting
Uses a vowel-pattern algorithm to estimate syllables:
- Counts groups of vowels (a, e, i, o, u, y)
- Accounts for silent 'e' endings
- Handles common exceptions

### Content Extraction
Intelligently extracts readable content:
- Prioritizes `<article>`, `<main>`, and content areas
- Excludes navigation, sidebars, and code blocks
- Analyzes paragraphs, headings, and list items

## License

MIT License - feel free to use, modify, and distribute.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

---

**ReadScore** — *See how readable your web is*
