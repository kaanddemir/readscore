# ReadScore

<div align="center">
  <img src="icons/icon128.png" alt="ReadScore Logo" width="128" height="128">
</div>

### Analyze readability, generate AI summaries, and use focused reading tools.

## Overview

**ReadScore** is a privacy-first Chrome extension for understanding and improving how readable a page feels. It combines transparent readability metrics, a local reader overlay, and Chrome's built-in AI summarization when available.

The extension is designed to stay explainable:
- Readability analysis is rule-based and runs locally in the browser.
- Reader tools work directly on the page without sending your content to a remote backend.
- AI Summary uses Chrome's built-in summarizer support when your browser provides it.

## Features

- **General Analysis**
  - Readability Score
  - Words per Sentence
  - Total Words
- **Selection Analysis**
  - Analyze only the text you selected on the page
  - Short selections are blocked with a clear warning
- **AI Summary**
  - Generates a page summary in a draggable on-page panel
  - Supports different summary types and lengths
  - Uses Chrome's built-in AI summarizer when available
- **Reading Tools**
  - Focus Mode
  - Tracking Assist
  - Reading Guide
- **Local Preferences**
  - Stores reading tool toggle states locally
  - Remembers AI Summary type and length settings

## How It Works

1. **Content Extraction**  
   ReadScore identifies readable page content from the active tab and filters out noise such as navigation, banners, and sidebars.

2. **Readability Analysis**  
   The extension calculates explainable metrics such as readability level, sentence length, and total word count using local JavaScript logic.

3. **Reader Tools**  
   Focus Mode rebuilds a cleaner reading surface, Tracking Assist adjusts spacing, and Reading Guide adds a line-following aid.

4. **AI Summary**  
   If Chrome's summarizer is available, ReadScore prepares a cleaned summary input and renders the result in an on-page summary panel.

## Requirements

- Chrome or a Chromium-based browser with extension support
- For **AI Summary**, Chrome's built-in summarizer must be available
- The AI Summary help text currently targets **Chrome 138+**

All non-AI features still work without summarizer support.

## Privacy

ReadScore is built to run locally.

- Readability analysis runs in-browser
- Reader tools run in-browser
- Preferences are stored locally with `chrome.storage.local`
- ReadScore does not operate a backend or send analyzed page content to external servers

For full details, see [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## Installation

### Chrome Web Store

[Install ReadScore](https://chromewebstore.google.com/detail/readscore/ocklmdaccbpakdjnkhckobkoochkajeg?authuser=0&hl=en)

### Manual Installation

1. Clone this repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.

## Project Structure

```bash
ReadScore/
├── icons/                  # Extension icons
├── popup/
│   ├── popup.html          # Popup markup
│   ├── popup.css           # Popup styles
│   └── popup.js            # Popup logic and Chrome messaging
├── src/
│   ├── analyzer.js         # Readability analysis logic
│   ├── content.js          # Page extraction and AI summary panel logic
│   ├── easyread.js         # Focus Mode, Tracking Assist, Reading Guide
│   └── easyread-styles.css # Injected reading-tool styles
├── manifest.json           # Extension manifest
├── PRIVACY_POLICY.md       # Privacy policy
└── README.md               # Project documentation
```

## Permissions

| Permission | Why it is needed |
| :--- | :--- |
| `activeTab` | Read the currently active page only when the user invokes the extension |
| `scripting` | Inject content and reading-tool scripts into the active page |
| `storage` | Save local preferences such as reading tool toggles and summary settings |

## Roadmap

- Saved reader presets for Focus Mode
- Better section-aware extraction for complex layouts
- Copy or export AI summaries
- Firefox and Edge support evaluation

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Push the branch.
5. Open a pull request.

## License

Distributed under the MIT License. See `LICENSE` for details.

<br>

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>
