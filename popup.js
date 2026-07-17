const elements = {
    title: document.getElementById("popup-title"),
    checkBtn: document.getElementById("check-btn"),
    clearBtn: document.getElementById("clear-btn"),
    summary: document.getElementById("popup-summary"),
    log: document.getElementById("popup-log"),
    empty: document.getElementById("popup-empty"),
};

// i18n
elements.title.textContent = chrome.i18n.getMessage("popupTitle");
elements.checkBtn.textContent = chrome.i18n.getMessage("popupCheckBtn");
elements.clearBtn.textContent = chrome.i18n.getMessage("popupClearBtn");
elements.empty.textContent = chrome.i18n.getMessage("popupNoHistory");

// Check if current tab is Kobo
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.url?.includes(".kobo.com")) {
        elements.checkBtn.disabled = false;
    } else {
        elements.checkBtn.textContent = chrome.i18n.getMessage("popupNotKobo");
    }
});

// Load history on open
loadHistory();

// Real-time updates from content.js via storage changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.checkLog) {
        renderLog(changes.checkLog.newValue || []);
    }
});

// Check button
elements.checkBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    elements.checkBtn.disabled = true;
    elements.checkBtn.textContent = chrome.i18n.getMessage("btnCheckingPage");

    chrome.tabs.sendMessage(tab.id, { action: "checkPage" }, (response) => {
        // If content script is not loaded or other error, fallback to resetting button
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            elements.checkBtn.disabled = false;
            elements.checkBtn.textContent = chrome.i18n.getMessage("popupCheckBtn");
        }
    });

    setTimeout(() => {
        elements.checkBtn.disabled = false;
        elements.checkBtn.textContent = chrome.i18n.getMessage("popupCheckBtn");
    }, 2000);
});

// Clear button
elements.clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove("checkLog");
    renderLog([]);
});

async function loadHistory() {
    const { checkLog = [] } = await chrome.storage.local.get("checkLog");
    renderLog(checkLog);
}

function renderLog(log) {
    elements.log.querySelectorAll(".log-item").forEach((el) => el.remove());

    if (log.length === 0) {
        elements.empty.style.display = "block";
        elements.summary.classList.remove("visible");
        return;
    }

    elements.empty.style.display = "none";

    // Summary stats
    const stats = { latest: 0, outdated: 0, skipped: 0, failed: 0 };
    for (const entry of log) {
        if (Object.hasOwn(stats, entry.status)) stats[entry.status]++;
    }
    elements.summary.classList.add("visible");
    elements.summary.replaceChildren();
    for (const [key, count] of Object.entries(stats)) {
        if (count === 0) continue;
        const stat = document.createElement("span");
        stat.classList.add("stat");
        const dot = document.createElement("span");
        dot.classList.add("stat-dot", key);
        const statusKey = "status" + key.charAt(0).toUpperCase() + key.slice(1);
        stat.append(dot, document.createTextNode(` ${chrome.i18n.getMessage(statusKey)} ${count}`));
        elements.summary.appendChild(stat);
    }

    // Log items (newest first)
    for (const entry of [...log].reverse()) {
        const item = document.createElement("div");
        item.classList.add("log-item");

        const info = document.createElement("div");
        info.classList.add("log-item-info");

        const title = document.createElement("div");
        title.classList.add("log-item-title");
        title.textContent = entry.title;
        title.title = entry.title;

        const time = document.createElement("div");
        time.classList.add("log-item-time");
        time.textContent = formatTime(entry.checkedAt);

        info.append(title, time);

        const status = document.createElement("span");
        status.classList.add("log-item-status", entry.status);
        const statusKey = "status" + entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
        status.textContent = chrome.i18n.getMessage(statusKey);

        item.append(info, status);

        // Update link for outdated books
        if (entry.status === "outdated" && entry.storeUrl) {
            const updateLink = document.createElement("a");
            updateLink.classList.add("log-item-update");
            updateLink.href = entry.storeUrl;
            updateLink.target = "_blank";
            updateLink.textContent = "↗";
            updateLink.title = chrome.i18n.getMessage("popupViewUpdate");
            item.appendChild(updateLink);
        }

        elements.log.appendChild(item);
    }
}

function formatTime(isoString) {
    try {
        const date = new Date(isoString);
        const diffMs = Date.now() - date.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const diffHour = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 1) return chrome.i18n.getMessage("timeJustNow");
        if (diffMin < 60) return chrome.i18n.getMessage("timeMinAgo", [String(diffMin)]);
        if (diffHour < 24) return chrome.i18n.getMessage("timeHourAgo", [String(diffHour)]);
        if (diffDay < 30) return chrome.i18n.getMessage("timeDayAgo", [String(diffDay)]);
        return date.toLocaleDateString();
    } catch {
        return isoString;
    }
}
