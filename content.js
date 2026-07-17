// 1. 內建輕量化多語系支援 (取代外部 typesafe-i18n)
const LL = {
    HEADER: { MESSAGE: chrome.i18n.getMessage("headerMessage") },
    BUTTON: {
        OKAY: chrome.i18n.getMessage("btnOkay"),
        CHECK_PAGE: chrome.i18n.getMessage("btnCheckPage"),
        CHECKING_PAGE: chrome.i18n.getMessage("btnCheckingPage"),
        CHECK_SINGLE: chrome.i18n.getMessage("btnCheckSingle"),
        COPY_OUTDATED: chrome.i18n.getMessage("btnCopyOutdated"),
    },
    STATUS: {
        PENDING: chrome.i18n.getMessage("statusPending"),
        CHECKING: chrome.i18n.getMessage("statusChecking"),
        LATEST: chrome.i18n.getMessage("statusLatest"),
        OUTDATED: chrome.i18n.getMessage("statusOutdated"),
        PREVIEW: chrome.i18n.getMessage("statusPreview"),
        SKIPPED: chrome.i18n.getMessage("statusSkipped"),
        FAILED: chrome.i18n.getMessage("statusFailed"),
    },
    ERROR: {
        UNLISTED: chrome.i18n.getMessage("errUnlisted"),
        PARSING: chrome.i18n.getMessage("errParsing"),
        UNKNOWN: chrome.i18n.getMessage("errUnknown"),
    },
    MESSAGE: {
        FINISHED_CHECKING_PAGE: ({ latest, outdated, skipped, failed }) =>
            chrome.i18n.getMessage("msgFinished", [String(latest), String(outdated), String(skipped), String(failed)]),
        NO_BOOKS_BEEN_CHECKED: chrome.i18n.getMessage("msgNoChecked"),
        NO_BOOKS_WERE_OUTDATED: chrome.i18n.getMessage("msgNoOutdated"),
        COPIED_BOOKS: (num) => chrome.i18n.getMessage("msgCopied", [String(num)])
    }
};

// 2. 注入 CSS 樣式 (取代 GM.addStyle)
if (!document.getElementById('kobo-update-checker-style')) {
    const style = document.createElement('style');
    style.id = 'kobo-update-checker-style';
    style.textContent = `
        .library-container .update-container { text-align: right; }
        .library-container .update-controls { min-width: 13rem; width: auto; }
        .library-container .update-button {
            border-radius: 8px; min-width: 0; max-width: 100%; width: auto;
            padding: 8px 16px;
            background-color: #f8f9fa; color: #333;
            border: 1px solid #dee2e6;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            font-size: 1.5rem; font-family: "Inter", "Rakuten Sans UI", "Trebuchet MS", sans-serif;
            font-weight: 500; text-align: center; text-overflow: ellipsis;
            position: relative; white-space: nowrap; cursor: pointer;
            transition: all 0.2s ease-in-out;
        }
        .library-container .update-button:not(:first-child) { margin-left: 8px; }
        .library-container .update-button:hover { 
            background-color: #fff; 
            border-color: #ced4da;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
            transform: translateY(-1px);
        }
        .library-container .update-button:active { 
            background-color: #e9ecef; 
            transform: translateY(0);
            box-shadow: none;
        }
        .library-container .update-button:disabled { 
            background-color: #e9ecef; color: #adb5bd; border-color: #e9ecef; pointer-events: none; 
        }
        
        @media (max-width: 568px) {
            .library-container .secondary-controls { margin-right: 18px; }
            .library-container .update-container { margin-bottom: 1.5rem; width: 100%; display: flex; flex-direction: column; text-align: left; }
            .library-container .update-controls { margin-right: 0; width: 100%; white-space: break-spaces; }
            .library-container .update-button { margin-left: 0 !important; margin-right: 0 !important; width: 100%; text-align: center; }
            .library-container .update-button:not(:first-child) { margin-top: 8px; }
            .library-container .library-content.grid .more-actions:not(.open) { width: fit-content; transform: translateY(35px); }
        }
        
        .item-wrapper.book[data-check-status=outdated] .product-field.item-status { background: #ffe3e3; color: #c92a2a; border-radius: 4px; padding: 2px 6px; font-weight: 500; display: inline-block; }
        .item-wrapper.book[data-check-status=skipped] .product-field.item-status { background: #f1f3f5; color: #495057; border-radius: 4px; padding: 2px 6px; font-weight: 500; display: inline-block; }
        .item-wrapper.book[data-check-status=failed] .product-field.item-status { background: #fff3bf; color: #e67700; border-radius: 4px; padding: 2px 6px; font-weight: 500; display: inline-block; }
        .item-wrapper.book:is([data-check-status=skipped], [data-check-status=failed]) .product-field.item-status a { text-decoration-line: underline; cursor: help; color: inherit; }
    `;
    document.head.append(style);
}

// 3. 內建輕量化非同步佇列系統 (取代外部 queue.js)
class TaskQueue {
    constructor(concurrency = 6) {
        this.concurrency = concurrency;
        this.active = 0;
        this.queue = [];
    }
    add(task) {
        return new Promise((resolve) => {
            this.queue.push(async () => {
                this.active++;
                try { await task(); } catch (e) { console.error(e); }
                this.active--;
                resolve();
                this.next();
            });
            this.next();
        });
    }
    next() {
        if (this.queue.length > 0 && this.active < this.concurrency) {
            const task = this.queue.shift();
            task();
        }
    }
}
const queue = new TaskQueue(6);

const Status = {
    PENDING: "pending", CHECKING: "checking", LATEST: "latest",
    OUTDATED: "outdated", SKIPPED: "skipped", FAILED: "failed",
};

// 4. Modal 彈窗與剪貼簿功能 (取代 GM.setClipboard)
function showModal(message) {
    if (document.getElementById("kobo-checker-modal")) return;

    const modal = document.createElement("div");
    modal.id = "kobo-checker-modal";
    modal.classList.add("modal");
    modal.style.zIndex = "9999";
    modal.addEventListener("click", (e) => ((e.target === modal) && closeModal()));

    modal.innerHTML = `
        <div id="modal-content" class="library-modal">
            <div>
                <div class="wrapper">
                    <button class="modal-x close"></button>
                </div>
                <div class="wrapper">
                    <div class="action-container">
                        <h2 class="confirm">${LL.HEADER.MESSAGE}</h2>
                        <div id="dynamic-message-container"></div>
                        <div class="cta" style="display: block;">
                            <button class="primary-button okay">${LL.BUTTON.OKAY}</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const actionMessage = document.createElement("p");
    actionMessage.style.display = "inline-block";
    actionMessage.style.textAlign = "left";

    const lines = String(message).split("\n");
    lines.forEach((line, index) => {
        actionMessage.appendChild(document.createTextNode(line));
        if (index < lines.length - 1) {
            actionMessage.appendChild(document.createElement("br"));
        }
    });

    modal.querySelector("#dynamic-message-container").replaceWith(actionMessage);

    document.body.append(modal);
    document.body.classList.add("show-modal");

    modal.querySelector('.close').addEventListener('click', closeModal);
    modal.querySelector('.okay').addEventListener('click', closeModal);

    function closeModal() {
        document.body.classList.remove("show-modal");
        setTimeout(() => modal.remove(), 250);
    }
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        // Fallback
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
    }
}

// 5. 核心邏輯：初始化
init();

function init() {
    // 僅選取尚未被注入過的書籍節點
    const books = Array.from(document.querySelectorAll(".item-wrapper.book:not([data-checker-injected='true'])"));
    
    if (books.length === 0) return;

    for (const book of books) {
        // 標記為已處理
        book.dataset.checkerInjected = "true";

        const actions = book.querySelector(".item-info + .item-bar .library-actions-list");
        if (!actions) continue;

        const actionContainer = document.createElement("li");
        actionContainer.classList.add("library-actions-list-item");

        const action = document.createElement("button");
        action.classList.add("library-action");
        action.textContent = LL.BUTTON.CHECK_SINGLE;
        action.addEventListener("click", () => checkUpdate(book));

        actionContainer.appendChild(action);
        actions.appendChild(actionContainer);
    }

    // 確保頁面頂部的控制面板只會被注入一次
    const secondaryControls = document.querySelector(".secondary-controls");
    if (secondaryControls && !document.querySelector(".update-container")) {
        const updateContainer = document.createElement("div");
        updateContainer.classList.add("update-container");

        const updateControls = document.createElement("div");
        updateControls.classList.add("update-controls");

        const checkButton = document.createElement("button");
        checkButton.classList.add("update-button");
        checkButton.textContent = LL.BUTTON.CHECK_PAGE;
        checkButton.addEventListener("click", () => {
            const allBooks = Array.from(document.querySelectorAll(".item-wrapper.book"));
            checkUpdateForBooks(allBooks, checkButton);
        });

        const copyButton = document.createElement("button");
        copyButton.classList.add("update-button");
        copyButton.textContent = LL.BUTTON.COPY_OUTDATED;
        copyButton.addEventListener("click", async () => {
            const allBooks = Array.from(document.querySelectorAll(".item-wrapper.book"));
            if (!allBooks.some((b) => b.dataset.checkStatus)) {
                showModal(LL.MESSAGE.NO_BOOKS_BEEN_CHECKED);
                return;
            }

            const outdated = allBooks.filter((b) => (b.dataset.checkStatus === Status.OUTDATED));
            if (outdated.length > 0) {
                const textToCopy = outdated.map(getBookTitle).join("\n");
                await copyToClipboard(textToCopy);
                showModal(LL.MESSAGE.COPIED_BOOKS(outdated.length));
            } else {
                showModal(LL.MESSAGE.NO_BOOKS_WERE_OUTDATED);
            }
        });

        updateControls.append(checkButton, copyButton);
        updateContainer.appendChild(updateControls);
        secondaryControls.insertBefore(updateContainer, secondaryControls.firstChild);
    }
}

async function checkUpdateForBooks(books, checkButton) {
    checkButton.disabled = true;
    checkButton.textContent = LL.BUTTON.CHECKING_PAGE;

    const checkPromises = books.map(book => checkUpdate(book));
    await Promise.all(checkPromises);

    let stats = { latest: 0, outdated: 0, skipped: 0, failed: 0 };
    for (const book of books) {
        if (stats.hasOwnProperty(book.dataset.checkStatus)) {
            stats[book.dataset.checkStatus]++;
        }
    }

    showModal(LL.MESSAGE.FINISHED_CHECKING_PAGE(stats));
    checkButton.disabled = false;
    checkButton.textContent = LL.BUTTON.CHECK_PAGE;
}

function getBookTitle(book) { return book.querySelector(".product-field.title")?.innerText || "Unknown Title"; }

function getCurrentProductId(book) {
    const actionElement = book.querySelector(".library-action.mark-as-finished, .library-action.remove-from-archive");
    if (!actionElement?.dataset?.koboGizmoConfig) {
        throw new Error(LL.ERROR.PARSING);
    }
    const config = JSON.parse(actionElement.dataset.koboGizmoConfig);
    return config.productId;
}

function getStorePageUrl(book) {
    const titleUrl = book.querySelector(".product-field.title a")?.href;
    if (titleUrl?.startsWith("https://www.kobo.com/")) return titleUrl;
    try {
        const actionEl = book.querySelector(".library-action:is(.mark-as-finished, .remove-from-archive)");
        const imageUrl = JSON.parse(actionEl.dataset.koboGizmoConfig).imageUrl;
        const productCode = imageUrl.substring(imageUrl.lastIndexOf("/") + 1, imageUrl.lastIndexOf("."));
        return `${location.origin}${location.pathname.substring(0, location.pathname.indexOf("/library"))}/ebook/${productCode}`;
    } catch (e) { return null; }
}

async function getLatestProductId(book) {
    const storeUrl = getStorePageUrl(book);
    if (!storeUrl) throw new Error(LL.ERROR.PARSING);

    const response = await fetch(storeUrl, { credentials: "same-origin" });
    if (!response.ok) {
        throw new Error(response.status === 404 ? LL.ERROR.UNLISTED : LL.ERROR.UNKNOWN);
    }

    const html = await response.text();
    const parser = new DOMParser();
    const page = parser.parseFromString(html, "text/html");

    const itemId = page.querySelector("#ratItemId");
    if (itemId) return itemId.value;

    const config = page.querySelector(".item-detail");
    if (config?.dataset?.koboGizmoConfig) return JSON.parse(config.dataset.koboGizmoConfig).productId;

    throw new Error(LL.ERROR.PARSING);
}

function checkUpdate(book) {
    return queue.add(async () => {
        const message = book.querySelector(".product-field.item-status");
        if (!message) return;

        book.dataset.checkStatus = Status.CHECKING;
        message.textContent = LL.STATUS.CHECKING;

        if (book.dataset.koboGizmo === "PreviewLibraryItem") {
            book.dataset.checkStatus = Status.SKIPPED;
            message.classList.remove("buy-now");
            message.replaceChildren(LL.STATUS.PREVIEW);
            return;
        }

        try {
            const currentId = getCurrentProductId(book);
            const latestId = await getLatestProductId(book);

            if (!currentId || !latestId) throw new Error(LL.ERROR.PARSING);

            if (currentId === latestId) {
                book.dataset.checkStatus = Status.LATEST;
                message.replaceChildren(LL.STATUS.LATEST);
            } else {
                book.dataset.checkStatus = Status.OUTDATED;
                message.replaceChildren(LL.STATUS.OUTDATED);
            }
        } catch (e) {
            book.dataset.checkStatus = Status.FAILED;
            const link = document.createElement("a");
            link.textContent = LL.STATUS.FAILED;
            link.addEventListener("click", () => showModal(e.message));
            message.replaceChildren(link);
        }
    });
}