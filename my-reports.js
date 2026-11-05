/* =========================================
   CIVICLENS — MY REPORTS
   Backend: GET /api/reports/<email>
========================================= */

(() => {
    "use strict";

    const API_BASE = "http://127.0.0.1:5000/api";
    const MAX_IMAGE_PREVIEW_LENGTH = 12_000_000;

    const $ = (selector) => document.querySelector(selector);

    const reportList = $("#report-list");
    const searchInput = $("#report-search");
    const statusFilter = $("#status-filter");
    const resultsSummary = $("#results-summary");
    const reportCountLabel = $("#report-count-label");
    const clearFiltersButton = $("#clear-filters");
    const refreshButton = $("#refresh-reports");
    const toast = $("#toast");

    let allReports = [];
    let toastTimer = null;
    let loadingReports = false;

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function getSessionUser() {
        try {
            const raw = sessionStorage.getItem("civicfixUser");

            if (!raw) return null;

            const user = JSON.parse(raw);

            if (!user || typeof user !== "object") return null;

            const email = typeof user.email === "string"
                ? user.email.trim().toLowerCase()
                : "";

            if (!email) return null;

            return {
                ...user,
                email,
                name: user.name || user.full_name || "Citizen"
            };
        } catch (error) {
            console.error(
                "Could not read the saved CivicLens user:",
                error
            );

            return null;
        }
    }

    function normalizeStatus(value) {
        const status = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ");

        if (
            ["resolved", "completed", "closed", "fixed", "done"]
                .includes(status)
        ) {
            return "resolved";
        }

        if (
            ["rejected", "declined", "not accepted", "denied"]
                .includes(status)
        ) {
            return "rejected";
        }

        if (
            [
                "progress",
                "in progress",
                "processing",
                "assigned",
                "accepted",
                "ongoing",
                "under process"
            ].includes(status)
        ) {
            return "progress";
        }

        return "pending";
    }

    function statusLabel(status) {
        return {
            progress: "In progress",
            pending: "Pending",
            resolved: "Resolved",
            rejected: "Rejected",
        }[status] || "Pending";
    }

    function getCategory(report) {
        const category =
            report.category_label ||
            report.ai_category ||
            report.category ||
            report.predicted_category ||
            report.department ||
            "";

        if (
            !category ||
            [
                "no issue detected",
                "unknown",
                "none",
                "null"
            ].includes(String(category).trim().toLowerCase())
        ) {
            return "Awaiting issue classification";
        }

        return String(category);
    }

    function formatDate(report) {
        const raw =
            report.created_at ||
            report.createdAt ||
            report.submitted_at ||
            report.timestamp ||
            report.date;

        if (raw) {
            const date = new Date(raw);

            if (!Number.isNaN(date.getTime())) {
                return date.toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                });
            }
        }

        const id = String(report.id || report._id || "");

        if (/^[a-f\d]{24}$/i.test(id)) {
            const date = new Date(
                parseInt(id.slice(0, 8), 16) * 1000
            );

            if (!Number.isNaN(date.getTime())) {
                return date.toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                });
            }
        }

        return "Date unavailable";
    }

    function getReportId(report) {
        return String(
            report.complaint_id ||
            report.id ||
            report._id ||
            report.report_id ||
            ""
        );
    }

    function imageSource(report) {
        const value = report.image_url || report.image || "";

        if (typeof value !== "string" || !value.trim()) {
            return "";
        }

        const image = value.trim();

        if (
            /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image)
        ) {
            return image.length <= MAX_IMAGE_PREVIEW_LENGTH
                ? image
                : "";
        }

        if (/^https?:\/\//i.test(image)) {
            try {
                const url = new URL(image);

                return ["http:", "https:"].includes(url.protocol)
                    ? url.href
                    : "";
            } catch (_) {
                return "";
            }
        }

        if (image.startsWith("/") && !image.startsWith("//")) {
            try {
                return new URL(image, API_BASE).href;
            } catch (_) {
                return "";
            }
        }

        return "";
    }

    function showToast(message, isError = false) {
        if (!toast) return;

        toast.textContent = message;
        toast.classList.toggle("toast-error", isError);
        toast.classList.add("show");

        clearTimeout(toastTimer);

        toastTimer = setTimeout(() => {
            toast.classList.remove("show");
        }, 3200);
    }

    function setupUser() {
        const user = getSessionUser();

        if (!user) {
            window.location.replace("login.html");
            return null;
        }

        const nameElement = $("#user-name");
        const avatarElement = $("#user-avatar");

        if (nameElement) {
            nameElement.textContent = user.name;
        }

        if (avatarElement) {
            avatarElement.textContent =
                (user.name.trim().charAt(0) || "U").toUpperCase();
        }

        return user;
    }

    function setupNavigation() {
        const menuButton = $("#mobile-menu-toggle");
        const nav = $("#main-nav");

        menuButton?.addEventListener("click", () => {
            const isOpen = nav?.classList.toggle("open") ?? false;

            menuButton.setAttribute(
                "aria-expanded",
                String(isOpen)
            );

            menuButton.setAttribute(
                "aria-label",
                isOpen ? "Close navigation" : "Open navigation"
            );
        });

        nav?.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                nav.classList.remove("open");

                menuButton?.setAttribute(
                    "aria-expanded",
                    "false"
                );

                menuButton?.setAttribute(
                    "aria-label",
                    "Open navigation"
                );
            });
        });

        $("#sign-out-btn")?.addEventListener("click", async () => {
            const signOutButton = $("#sign-out-btn");

            if (signOutButton) {
                signOutButton.disabled = true;
            }

            try {
                // Clear the server-side Flask session.
                await fetch(`${API_BASE}/logout`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        Accept: "application/json"
                    }
                });
            } catch (error) {
                console.error(
                    "Could not contact the logout endpoint:",
                    error
                );
            } finally {
                // Always clear the local login state.
                sessionStorage.removeItem("civicfixUser");
                window.location.replace("login.html");
            }
        });
    }

    function updateStatistics(reports) {
        const counts = {
            total: reports.length,
            progress: 0,
            resolved: 0,
            pending: 0
        };

        reports.forEach((report) => {
            const status = normalizeStatus(report.status);

            if (status === "progress") {
                counts.progress++;
            } else if (status === "resolved") {
                counts.resolved++;
            } else {
                counts.pending++;
            }
        });

        if ($("#total-count")) {
            $("#total-count").textContent = counts.total;
        }

        if ($("#progress-count")) {
            $("#progress-count").textContent = counts.progress;
        }

        if ($("#resolved-count")) {
            $("#resolved-count").textContent = counts.resolved;
        }

        if ($("#pending-count")) {
            $("#pending-count").textContent = counts.pending;
        }
    }

    function renderReport(report) {
        const id = getReportId(report);
        const status = normalizeStatus(report.status);
        const category = getCategory(report);
        const description = String(
            report.description || "No description provided."
        );
        const address = String(
            report.address ||
            report.location ||
            "Location not provided"
        );
        const date = formatDate(report);
        const src = imageSource(report);

        const imageHTML = src
            ? `
                <img
                    class="report-image"
                    src="${escapeHTML(src)}"
                    alt="Photo attached to complaint"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                >
            `
            : `
                <div
                    class="report-image-placeholder"
                    aria-label="No image available"
                >▧</div>
            `;

        const card = document.createElement("article");
        card.className = "report-card";

        card.innerHTML = `
            <div class="report-image-wrap">
                ${imageHTML}
            </div>

            <div class="report-main">
                <div class="report-title-row">
                    <h3 class="report-title">
                        ${escapeHTML(category)}
                    </h3>

                    <span class="status-badge status-${status}">
                        ${escapeHTML(statusLabel(status))}
                    </span>
                </div>

                <p class="report-description">
                    ${escapeHTML(description)}
                </p>

                <div class="report-meta">
                    <span class="meta-item">
                        <span class="meta-symbol" aria-hidden="true">⌖</span>
                        <span>${escapeHTML(address)}</span>
                    </span>

                    <span class="meta-item">
                        <span class="meta-symbol" aria-hidden="true">◷</span>
                        <span>${escapeHTML(date)}</span>
                    </span>
                </div>
            </div>

            <div class="report-side">
                <span class="report-id-label">COMPLAINT ID</span>

                <code class="report-id">
                    ${escapeHTML(id || "Not available")}
                </code>

                ${
                    id
                        ? `
                            <button
                                class="copy-id-button"
                                type="button"
                                data-copy-id="${escapeHTML(id)}"
                            >Copy ID</button>
                        `
                        : ""
                }
            </div>
        `;

        const image = card.querySelector(".report-image");

        image?.addEventListener("error", () => {
            const wrapper = image.closest(".report-image-wrap");

            if (wrapper) {
                wrapper.innerHTML = `
                    <div
                        class="report-image-placeholder"
                        aria-label="Image unavailable"
                    >▧</div>
                `;
            }
        }, { once: true });

        return card;
    }

    function showEmptyState(
        title,
        message,
        showCreateButton = false
    ) {
        reportList.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" aria-hidden="true">▤</span>

                <h3>${escapeHTML(title)}</h3>
                <p>${escapeHTML(message)}</p>

                ${
                    showCreateButton
                        ? `
                            <a
                                href="report.html#report-form-section"
                                class="button button-primary"
                            >
                                Report an Issue
                            </a>
                        `
                        : ""
                }
            </div>
        `;
    }

    function showErrorState(message) {
        reportList.innerHTML = `
            <div class="error-state">
                <span class="error-icon" aria-hidden="true">!</span>

                <h3>Couldn't load your reports</h3>
                <p>${escapeHTML(message)}</p>

                <button
                    class="button button-primary"
                    type="button"
                    id="retry-reports"
                >
                    Try again
                </button>
            </div>
        `;

        $("#retry-reports")?.addEventListener(
            "click",
            loadReports
        );
    }

    function getFilteredReports() {
        const query = (searchInput?.value || "")
            .trim()
            .toLowerCase();

        const selectedStatus = statusFilter?.value || "all";

        return allReports.filter((report) => {
            const status = normalizeStatus(report.status);

            if (
                selectedStatus !== "all" &&
                status !== selectedStatus
            ) {
                return false;
            }

            if (!query) return true;

            const searchable = [
                getReportId(report),
                getCategory(report),
                report.description,
                report.address,
                report.location,
                report.status
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return searchable.includes(query);
        });
    }

    function renderReports() {
        if (!reportList) return;

        const filteredReports = getFilteredReports();

        reportList.replaceChildren();

        if (allReports.length === 0) {
            showEmptyState(
                "No reports yet",
                "You haven't submitted any civic issues. Start by reporting an issue in your area.",
                true
            );
        } else if (filteredReports.length === 0) {
            showEmptyState(
                "No matching reports",
                "Try another search term or choose a different status filter."
            );
        } else {
            const fragment = document.createDocumentFragment();

            filteredReports.forEach((report) => {
                fragment.appendChild(renderReport(report));
            });

            reportList.appendChild(fragment);
        }

        if (resultsSummary) {
            resultsSummary.textContent = allReports.length
                ? `${allReports.length} ${
                    allReports.length === 1
                        ? "complaint"
                        : "complaints"
                } submitted`
                : "Your submitted complaints will appear here.";
        }

        if (reportCountLabel) {
            reportCountLabel.textContent =
                `${filteredReports.length} ${
                    filteredReports.length === 1
                        ? "report"
                        : "reports"
                } shown`;
        }

        const hasFilters =
            (searchInput?.value || "").trim() !== "" ||
            (statusFilter?.value || "all") !== "all";

        if (clearFiltersButton) {
            clearFiltersButton.hidden = !hasFilters;
        }
    }

    // GET /api/reports/<email>
    async function loadReports() {
        // Prevent simultaneous refresh requests.
        if (loadingReports) return;

        const user = getSessionUser();

        if (!user) {
            window.location.replace("login.html");
            return;
        }

        if (!reportList) {
            console.error(
                'My Reports page is missing the element "#report-list".'
            );
            return;
        }

        loadingReports = true;

        reportList.innerHTML = `
            <div class="loading-state">
                <span
                    class="loading-spinner"
                    aria-hidden="true"
                ></span>

                <p>Loading your reports...</p>
            </div>
        `;

        if (resultsSummary) {
            resultsSummary.textContent =
                "Fetching your submitted complaints...";
        }

        if (refreshButton) {
            refreshButton.disabled = true;
            refreshButton.setAttribute("aria-busy", "true");
        }

        try {
            const response = await fetch(
                `${API_BASE}/reports/${encodeURIComponent(user.email)}`,
                {
                    method: "GET",

                    // IMPORTANT:
                    // Send the Flask session cookie with this request.
                    credentials: "include",

                    headers: {
                        Accept: "application/json"
                    },

                    cache: "no-store"
                }
            );

            let payload;

            try {
                payload = await response.json();
            } catch (_) {
                throw new Error(
                    "The server returned an invalid response."
                );
            }

            // Authentication failure: the Flask session is missing
            // or expired. Do not treat it as an empty report list.
            if (response.status === 401) {
                sessionStorage.removeItem("civicfixUser");

                showErrorState(
                    "Your login session has expired. Please log in again."
                );

                if (resultsSummary) {
                    resultsSummary.textContent =
                        "Authentication required.";
                }

                showToast(
                    "Your session expired. Please log in again.",
                    true
                );

                // Give the user a chance to read the error and
                // click Try again only after signing in again.
                const retryButton = $("#retry-reports");

                if (retryButton) {
                    retryButton.textContent = "Go to login";

                    retryButton.addEventListener("click", () => {
                        window.location.replace("login.html");
                    }, { once: true });
                }

                return;
            }

            if (response.status === 403) {
                throw new Error(
                    payload.error ||
                    "You are not authorized to view these reports."
                );
            }

            if (!response.ok || payload.success === false) {
                throw new Error(
                    payload.error ||
                    payload.message ||
                    `Request failed (${response.status}).`
                );
            }

            // Supports either { reports: [...] } or a direct array.
            const reports = Array.isArray(payload)
                ? payload
                : payload.reports;

            if (!Array.isArray(reports)) {
                console.error(
                    "Unexpected reports API response:",
                    payload
                );

                throw new Error(
                    "The server response did not contain a reports list. Check the Flask response format."
                );
            }

            allReports = reports;

            updateStatistics(allReports);
            renderReports();

        } catch (error) {
            console.error(
                "Failed to load CivicLens reports:",
                error
            );

            updateStatistics([]);

            if (resultsSummary) {
                resultsSummary.textContent =
                    "Unable to retrieve reports.";
            }

            const message = error instanceof TypeError
                ? "Unable to connect to the backend. Check that Flask is running and that your frontend origin is allowed by CORS."
                : error.message ||
                    "Please check your connection and try again.";

            showErrorState(message);

            if (reportCountLabel) {
                reportCountLabel.textContent = "0 reports";
            }

            showToast("Unable to load reports.", true);

        } finally {
            loadingReports = false;

            if (refreshButton) {
                refreshButton.disabled = false;
                refreshButton.removeAttribute("aria-busy");
            }
        }
    }

    // Search and filtering
    searchInput?.addEventListener("input", renderReports);
    statusFilter?.addEventListener("change", renderReports);

    refreshButton?.addEventListener("click", loadReports);

    clearFiltersButton?.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (statusFilter) statusFilter.value = "all";

        renderReports();
    });

    // Copy complaint ID
    reportList?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-copy-id]");

        if (!button) return;

        const id = button.getAttribute("data-copy-id");

        if (!id) return;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(id);
            } else {
                const temporary = document.createElement("textarea");

                temporary.value = id;
                temporary.style.position = "fixed";
                temporary.style.opacity = "0";

                document.body.appendChild(temporary);
                temporary.select();

                const copied = document.execCommand("copy");

                temporary.remove();

                if (!copied) {
                    throw new Error("Copy command failed.");
                }
            }

            showToast("Complaint ID copied.");

        } catch (error) {
            console.error(
                "Could not copy complaint ID:",
                error
            );

            showToast(
                "Could not copy the ID. Please select it and copy manually.",
                true
            );
        }
    });

    // Initialize the page
    const user = setupUser();

    if (user) {
        setupNavigation();
        loadReports();
    }
})();