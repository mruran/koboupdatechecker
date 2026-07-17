chrome.action.onClicked.addListener((tab) => {
    // Only inject if the URL is kobo.com
    if (tab.url && tab.url.includes(".kobo.com")) {
        chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content.css']
        });
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
    }
});
