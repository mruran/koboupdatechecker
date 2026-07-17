# Kobo Update Checker

A lightweight, modern Chrome Extension (Manifest V3) that helps you easily check if there are updates available for your purchased e-books on the Kobo website.

## ✨ Features

- **One-Click Check**: Instantly check all e-books on the current Kobo library page for available updates.
- **Modern & Secure**: Built using Manifest V3 standards with safe DOM node injection (XSS-proof) and optimized MutationObserver handling.
- **Multilingual Support**: Fully localized in English, Traditional Chinese, Japanese, and Korean.
- **Bulk Export**: Easily copy the titles of all outdated books to your clipboard with a single click.
- **Sleek UI**: Minimalist, non-intrusive UI that blends perfectly with Kobo's design aesthetics.

## 🚀 Installation (Developer Mode)

Since this extension is not yet published to the Chrome Web Store, you can easily load it locally:

1. Download or clone this repository to your local machine.
2. Open your Chromium-based browser (Chrome, Edge, Brave, etc.) and go to the extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** (載入未封裝項目).
5. Select the `koboupdatechecker` directory.
6. The extension is now installed! Navigate to your Kobo "My Books" page to see it in action.

## 🛠️ Tech Stack

- **JavaScript (Vanilla)**
- **Chrome Extensions API (Manifest V3)**
- **CSS** for modern UI styling

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*Created by [delong](https://github.com/mruran)*
