# Privacy Policy

**Last Updated:** January 28, 2026

## ReadScore Chrome Extension

## Overview

**ReadScore** is a privacy-first Chrome extension that analyzes the readability of web pages. We are committed to protecting your privacy and ensuring transparency in how our software operates. This policy outlines how ReadScore handles your data—which is to say, it stays entirely on your device.

## Data Collection

**We do not collect any personal data.**

ReadScore operates entirely locally within your browser. 
-   We **do not** track your browsing history.
-   We **do not** collect IP addresses or device identifiers.
-   We **do not** capture the text content you analyze.
-   We **do not** use cookies or tracking pixels.

## Data Storage

ReadScore stores a minimal amount of data **locally** on your device to remember your preferences:

-   **Highlighting Preference**: Stores whether you have the "Show Highlights" toggle turned on or off.

This data is stored using the `chrome.storage.local` API and never leaves your browser.

## How It Works

1.  **Local Analysis**: When you click the extension icon, ReadScore reads the text content of the *active tab*.
2.  **Processing**: The text is analyzed using JavaScript algorithms running entirely within your browser context.
3.  **Result Display**: Readability scores are calculated and displayed in the popup window.
4.  **Ephemeral Data**: The text extracted for analysis is processed in memory and is discarded as soon as the analysis is complete or the popup is closed.

## Permissions

ReadScore requests the minimum permissions necessary to function:

| Permission | Purpose |
| :--- | :--- |
| `activeTab` | Allows the extension to read the text content of the current page only when you explicitly invoke the extension. |
| `scripting` | Required to inject the analysis scripts and style the visual highlights on the page. |
| `storage` | Used to save your highlighting preference (On/Off) locally. |

## Third-Party Services

ReadScore **does not** use any third-party analytics, tracking services, or external APIs. All logic is self-contained within the extension files.

## Data Sharing

Since we do not collect any data, we **do not** (and cannot) share, sell, or disclose your personal information to any third parties, advertisers, or government agencies.

## Security

Because ReadScore operates locally, your data security is tied to the security of your own device and browser. By not transmitting data over the internet, we eliminate the risk of data interception or server-side breaches regarding your analysis.

## User Control

You have full control over the extension:
-   **Toggle Highlighting**: You can turn off visual highlighting at any time via the extension popup.
-   **Uninstall**: Removing the extension from Chrome will immediately delete all locally stored preferences associated with ReadScore.

## Changes to This Policy

We may update this Privacy Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. The "Last Updated" date at the top of this policy will indicate when the latest revisions were made.

## Contact

If you have any questions about this Privacy Policy or the ReadScore extension, please contact us at:

**Email**: [heykaan.dev@gmail.com](mailto:heykaan.dev@gmail.com)

## Summary

ReadScore is designed to be a tool you can trust. **We don't want your data.** We simply want to provide you with useful readability insights right in your browser.

<br>

<div align="center">
  <p>Built by <a href="https://heykaan.dev">heykaan.dev</a></p>
</div>
