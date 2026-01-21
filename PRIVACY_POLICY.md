# Privacy Policy for ReadScore

**Last Updated:** January 20, 2026

## Overview

ReadScore is a privacy-first Chrome extension that analyzes the readability of web pages. We are committed to protecting your privacy and being transparent about our data practices.

## Data Collection

**We do not collect any personal data.**

ReadScore operates entirely locally within your browser. Here's what that means:

### What We DON'T Do:
- We don't collect or store your browsing history
- We don't track the websites you visit
- We don't send any data to external servers
- We don't use analytics or tracking services
- We don't share any information with third parties
- We don't use cookies for tracking purposes

### What We DO:
- All text analysis happens **locally in your browser**
- Readability calculations are performed using simple, transparent algorithms
- Your highlight toggle preference is stored locally using Chrome's storage API (this never leaves your device)

## How ReadScore Works

1. When you click the extension icon, it reads the text content of the current web page
2. The text is analyzed using rule-based algorithms (sentence length, word complexity, etc.)
3. Results are displayed in the extension popup
4. If you enable highlighting, visual markers are added to the page temporarily
5. **No data ever leaves your browser**

## Permissions Explained

ReadScore requests the following permissions:

| Permission | Purpose |
|------------|---------|
| `activeTab` | Read content from the current tab when you click the extension icon |
| `scripting` | Inject the analysis script and highlighting styles into the page |
| `storage` | Remember your highlight toggle preference locally |

These permissions are the minimum required for the extension to function. We do not request access to all websites or browsing data.

## Local Storage

The only data stored locally is:
- Your highlight toggle preference (on/off)

This data:
- Is stored using Chrome's local storage API
- Never leaves your device
- Can be cleared by removing the extension

## Third-Party Services

ReadScore does not use any third-party services, APIs, or analytics tools. All functionality is self-contained within the extension.

## Open Source

ReadScore uses transparent, explainable algorithms. There are no AI models or machine learning components—just simple rules that you can understand and verify.

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last Updated" date at the top of this document.

## Contact

If you have any questions about this privacy policy or ReadScore, please open an issue on our GitHub repository or contact us at:

**Email:** [heykaan.dev@gmail.com](mailto:heykaan.dev@gmail.com)

---

**Summary:** ReadScore is designed with privacy as a core principle. We don't collect, store, or transmit any of your data. Everything happens locally in your browser.
