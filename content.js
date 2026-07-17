(() => {
    // Guard: if already loaded, re-run init for newly loaded books and exit
    if (window.__koboUpdateCheckerLoaded) {
        window.__koboUpdateCheckerInit?.();
        return;
    }
    window.__koboUpdateCheckerLoaded = true;

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

    // 2. 內建輕量化非同步佇列系統 (取代外部 queue.js)
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

    const FETCH_TIMEOUT_MS = 15000;

    const Status = {
        PENDING: "pending", CHECKING: "checking", LATEST: "latest",
        OUTDATED: "outdated", SKIPPED: "skipped", FAILED: "failed",
    };

    // 3. Modal 彈窗與剪貼簿功能 (取代 GM.setClipboard)
    function showModal(message) {
        if (document.getElementById("kobo-checker-modal")) return;

        // Build modal DOM tree without innerHTML to prevent XSS
        const modal = document.createElement("div");
        modal.id = "kobo-checker-modal";
        modal.classList.add("modal");
        modal.style.zIndex = "9999";

        const modalContent = document.createElement("div");
        modalContent.classList.add("library-modal");

        const innerDiv = document.createElement("div");

        // Close button wrapper
        const closeWrapper = document.createElement("div");
        closeWrapper.classList.add("wrapper");
        const closeBtn = document.createElement("button");
        closeBtn.classList.add("modal-x", "close");
        closeWrapper.appendChild(closeBtn);

        // Content wrapper
        const contentWrapper = document.createElement("div");
        contentWrapper.classList.add("wrapper");
        const actionContainer = document.createElement("div");
        actionContainer.classList.add("action-container");

        const heading = document.createElement("h2");
        heading.classList.add("confirm");
        heading.appendChild(document.createTextNode(LL.HEADER.MESSAGE));

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

        const ctaDiv = document.createElement("div");
        ctaDiv.classList.add("cta");
        ctaDiv.style.display = "block";
        const okayBtn = document.createElement("button");
        okayBtn.classList.add("primary-button", "okay");
        okayBtn.appendChild(document.createTextNode(LL.BUTTON.OKAY));
        ctaDiv.appendChild(okayBtn);

        actionContainer.append(heading, actionMessage, ctaDiv);
        contentWrapper.appendChild(actionContainer);
        innerDiv.append(closeWrapper, contentWrapper);
        modalContent.appendChild(innerDiv);
        modal.appendChild(modalContent);

        function closeModal() {
            modal.removeAttribute("id"); // Prevent race condition during animation
            document.body.classList.remove("show-modal");
            setTimeout(() => modal.remove(), 250);
        }

        modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
        closeBtn.addEventListener("click", closeModal);
        okayBtn.addEventListener("click", closeModal);

        document.body.append(modal);
        document.body.classList.add("show-modal");
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

    // 4. 核心邏輯：初始化
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

        const stats = { latest: 0, outdated: 0, skipped: 0, failed: 0 };
        for (const book of books) {
            if (Object.hasOwn(stats, book.dataset.checkStatus)) {
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
            if (!actionEl?.dataset?.koboGizmoConfig) return null;
            const imageUrl = JSON.parse(actionEl.dataset.koboGizmoConfig).imageUrl;
            const productCode = imageUrl.substring(imageUrl.lastIndexOf("/") + 1, imageUrl.lastIndexOf("."));
            return `${location.origin}${location.pathname.substring(0, location.pathname.indexOf("/library"))}/ebook/${productCode}`;
        } catch (e) { return null; }
    }

    async function getLatestProductId(book) {
        const storeUrl = getStorePageUrl(book);
        if (!storeUrl) throw new Error(LL.ERROR.PARSING);

        const response = await fetch(storeUrl, {
            credentials: "same-origin",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
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

    // Expose init for re-injection and run
    window.__koboUpdateCheckerInit = init;
    init();
})();