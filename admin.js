const API_BASE_URL = "http://127.0.0.1:5000";

document.addEventListener("DOMContentLoaded", () => {
    const $ = (selector) => document.querySelector(selector);

    const departmentForm = $("#addDepartmentForm");
    const departmentTableBody = $("#departmentTableBody");
    const departmentSearch = $("#departmentSearch");
    const departmentStatusFilter = $("#departmentStatusFilter");
    const formMessage = $("#departmentFormMessage");
    const categoryList = $("#categoryList");

    const rejectionTableBody = $("#rejectionRequestTableBody");
    const rejectionSearch = $("#rejectionSearch");
    const rejectionStatusFilter = $("#rejectionStatusFilter");

    const reassignmentTableBody = $("#reassignmentRequestTableBody");
    const reassignmentSearch = $("#reassignmentSearch");
    const reassignmentStatusFilter = $("#reassignmentStatusFilter");

    let departments = [];
    let availableCategories = [];
    let rejectionRequests = [];
    let reassignmentRequests = [];
    let categoriesLoaded = false;

    let admin = null;

    try {
        admin = JSON.parse(sessionStorage.getItem("civicfixUser"));
    } catch {
        admin = null;
    }

    if (
        !admin ||
        !["admin", "administrator"].includes(
            String(admin.role || "").toLowerCase()
        )
    ) {
        window.location.href = "login.html";
        return;
    }

    const adminName = admin.name || "Administrator";

    if ($("#adminName")) {
        $("#adminName").textContent = adminName;
    }

    if ($("#welcomeName")) {
        $("#welcomeName").textContent = adminName.split(" ")[0];
    }

    if ($("#currentYear")) {
        $("#currentYear").textContent = new Date().getFullYear();
    }

    // ---------------- GENERAL HELPERS ----------------

    function showFormMessage(message, type = "") {
        if (!formMessage) return;

        formMessage.textContent = message;
        formMessage.className = `admin-form-message ${type}`;
    }

    function clearFormMessage() {
        showFormMessage("");
    }

    function normalizeStatus(status) {
        return String(status || "active").trim().toLowerCase();
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return "—";

        return date.toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function firstValue(object, keys, fallback = "") {
        for (const key of keys) {
            const value = object?.[key];

            if (
                value !== undefined &&
                value !== null &&
                String(value).trim() !== ""
            ) {
                return value;
            }
        }

        return fallback;
    }

    function getManualReassignment(request) {
        const value =
            request?.manual_reassignment ||
            request?.reassignment_request ||
            {};

        return value && typeof value === "object" ? value : {};
    }

    function getReassignmentType(request) {
        const reassignment = getManualReassignment(request);

        const type = String(
            request?.request_type ||
            reassignment.request_type ||
            ""
        ).trim().toLowerCase();

        if (
            [
                "manual_assignment",
                "manual assignment",
                "ai_unclassified",
                "unclassified",
                "ai_review"
            ].includes(type)
        ) {
            return "manual_assignment";
        }

        if (
            String(
                request?.request_label ||
                reassignment.request_label ||
                ""
            ).toLowerCase().includes("manual complaint assignment")
        ) {
            return "manual_assignment";
        }

        if (
            String(reassignment.requested_by || "").toLowerCase() ===
            "ai system"
        ) {
            return "manual_assignment";
        }

        if (
            request?.ai_review_status === "pending" &&
            !request?.department
        ) {
            return "manual_assignment";
        }

        return "department_reassignment";
    }

    function getReassignmentLabel(request) {
        if (getReassignmentType(request) === "manual_assignment") {
            return "Manual Complaint Assignment";
        }

        return "Department Reassignment";
    }

    async function apiFetch(path, options = {}) {
        const response = await fetch(`${API_BASE_URL}${path}`, {
            credentials: "include",
            ...options,
            headers: {
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(options.headers || {})
            }
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                `Request failed (${response.status}).`
            );
        }

        return data;
    }

    function createTextCell(value) {
        const cell = document.createElement("td");
        cell.textContent = String(value ?? "");
        return cell;
    }

    function showEmptyRow(tbody, colspan, message) {
        if (!tbody) return;

        tbody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = colspan;
        cell.className = "admin-table-empty";
        cell.textContent = message;

        row.appendChild(cell);
        tbody.appendChild(row);
    }

    function createBadge(text, className) {
        const badge = document.createElement("span");
        badge.className = className;
        badge.textContent = text;
        return badge;
    }

    // ---------------- DEPARTMENT CATEGORIES ----------------

    async function loadCategories() {
        if (!categoryList) return;

        categoryList.textContent = "Loading available model categories...";
        categoriesLoaded = false;

        try {
            const data = await apiFetch("/api/admin/categories");

            availableCategories = Array.isArray(data.categories)
                ? data.categories
                : [];

            categoriesLoaded = true;
            renderCategoryOptions();
        } catch (error) {
            console.error("Category loading:", error);

            availableCategories = [];
            categoriesLoaded = false;

            categoryList.textContent =
                "Could not load categories. Check your admin login and backend.";
        }
    }

    function renderCategoryOptions() {
        if (!categoryList) return;

        categoryList.replaceChildren();

        if (!categoriesLoaded) {
            categoryList.textContent =
                "Categories could not be loaded. Refresh and try again.";
            return;
        }

        if (!availableCategories.length) {
            categoryList.textContent =
                "All model categories have already been allocated.";
            return;
        }

        availableCategories.forEach((category) => {
            const label = document.createElement("label");
            label.className = "category-option";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.name = "categories";
            checkbox.value = category;

            checkbox.setAttribute(
                "aria-label",
                `Assign ${category} to this department`
            );

            const text = document.createElement("span");
            text.textContent = category;

            label.append(checkbox, text);
            categoryList.appendChild(label);
        });
    }

    // ---------------- COMPLAINT STATISTICS ----------------

    async function loadComplaintStatistics() {
        try {
            const data = await apiFetch("/api/admin/reports");

            const reports = Array.isArray(data.reports)
                ? data.reports
                : [];

            const pending = reports.filter((report) =>
                [
                    "pending",
                    "submitted",
                    "open",
                    "progress",
                    "in progress",
                    "rejection requested",
                    "reassignment requested"
                ].includes(
                    String(report.status || "").trim().toLowerCase()
                )
            );

            if ($("#totalComplaints")) {
                $("#totalComplaints").textContent = reports.length;
            }

            if ($("#pendingComplaints")) {
                $("#pendingComplaints").textContent = pending.length;
            }
        } catch (error) {
            console.error("Complaint statistics:", error);

            if ($("#totalComplaints")) {
                $("#totalComplaints").textContent = "—";
            }

            if ($("#pendingComplaints")) {
                $("#pendingComplaints").textContent = "—";
            }
        }
    }

    // ---------------- DEPARTMENT MANAGEMENT ----------------

    async function loadDepartments() {
        showEmptyRow(
            departmentTableBody,
            5,
            "Loading departments..."
        );

        try {
            const data = await apiFetch("/api/admin/departments");

            departments = Array.isArray(data.departments)
                ? data.departments
                : [];

            renderDepartments();
            updateDepartmentStatistics();
            renderReassignmentRequests();
        } catch (error) {
            console.error("Department loading:", error);

            showEmptyRow(
                departmentTableBody,
                5,
                "Could not load departments. Check your login and backend."
            );

            if ($("#totalDepartments")) {
                $("#totalDepartments").textContent = "—";
            }

            if ($("#activeDepartments")) {
                $("#activeDepartments").textContent = "—";
            }

            if ($("#departmentResultCount")) {
                $("#departmentResultCount").textContent =
                    "Unable to load department records.";
            }
        }
    }

    function updateDepartmentStatistics() {
        const activeCount = departments.filter(
            (department) =>
                normalizeStatus(department.status) === "active"
        ).length;

        if ($("#totalDepartments")) {
            $("#totalDepartments").textContent = departments.length;
        }

        if ($("#activeDepartments")) {
            $("#activeDepartments").textContent = activeCount;
        }
    }

    function renderDepartments() {
        if (!departmentTableBody) return;

        const searchTerm = String(
            departmentSearch?.value || ""
        ).trim().toLowerCase();

        const selectedStatus = String(
            departmentStatusFilter?.value || "all"
        ).toLowerCase();

        const filtered = departments.filter((department) => {
            const name = String(department.name || "").toLowerCase();
            const email = String(department.email || "").toLowerCase();
            const status = normalizeStatus(department.status);

            return (
                (name.includes(searchTerm) ||
                    email.includes(searchTerm)) &&
                (selectedStatus === "all" ||
                    status === selectedStatus)
            );
        });

        departmentTableBody.replaceChildren();

        if (!filtered.length) {
            showEmptyRow(
                departmentTableBody,
                5,
                departments.length
                    ? "No departments match your search."
                    : "No departments have been created yet."
            );
        } else {
            filtered.forEach((department) => {
                const row = document.createElement("tr");

                const nameCell = document.createElement("td");
                const name = document.createElement("span");

                name.className = "admin-department-name";
                name.textContent = department.name || "—";
                nameCell.appendChild(name);

                const emailCell = document.createElement("td");
                const email = document.createElement("span");

                email.className = "admin-department-email";
                email.textContent = department.email || "—";
                emailCell.appendChild(email);

                const statusCell = document.createElement("td");
                const status = normalizeStatus(department.status);

                statusCell.appendChild(
                    createBadge(
                        status === "active" ? "Active" : "Inactive",
                        `admin-status ${
                            status === "active"
                                ? "admin-status-active"
                                : "admin-status-inactive"
                        }`
                    )
                );

                row.append(
                    nameCell,
                    emailCell,
                    statusCell,
                    createTextCell(formatDate(department.created_at)),
                    createTextCell("—")
                );

                departmentTableBody.appendChild(row);
            });
        }

        if ($("#departmentResultCount")) {
            $("#departmentResultCount").textContent =
                `Showing ${filtered.length} of ${departments.length} departments`;
        }
    }

    if (departmentForm) {
        departmentForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearFormMessage();

            const name = $("#departmentName")?.value.trim();
            const email = $("#departmentEmail")?.value.trim();
            const password = $("#departmentPassword")?.value;
            const status = $("#departmentStatus")?.value || "active";

            const categories = Array.from(
                document.querySelectorAll(
                    'input[name="categories"]:checked'
                )
            ).map((checkbox) => checkbox.value);

            const submitButton = $("#createDepartmentButton");

            if (!name || !email || !password) {
                showFormMessage(
                    "Please complete all required fields.",
                    "error"
                );
                return;
            }

            if (password.length < 8) {
                showFormMessage(
                    "Use a password with at least 8 characters.",
                    "error"
                );
                return;
            }

            if (!categoriesLoaded) {
                showFormMessage(
                    "Categories are not loaded. Refresh and try again.",
                    "error"
                );
                return;
            }

            if (!availableCategories.length) {
                showFormMessage(
                    "No unallocated categories are available.",
                    "error"
                );
                return;
            }

            if (!categories.length) {
                showFormMessage(
                    "Select at least one available AI category.",
                    "error"
                );
                return;
            }

            const allowedCategories = new Set(availableCategories);

            if (
                categories.some(
                    (category) => !allowedCategories.has(category)
                )
            ) {
                showFormMessage(
                    "Some categories are no longer available. Refresh the list.",
                    "error"
                );

                await loadCategories();
                return;
            }

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "Creating...";
            }

            try {
                const data = await apiFetch(
                    "/api/admin/departments",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            name,
                            email,
                            password,
                            status,
                            categories
                        })
                    }
                );

                showFormMessage(
                    data.message || "Department created successfully.",
                    "success"
                );

                departmentForm.reset();

                await Promise.all([
                    loadDepartments(),
                    loadComplaintStatistics(),
                    loadCategories()
                ]);
            } catch (error) {
                console.error("Department creation:", error);

                showFormMessage(
                    error.message || "Could not create department.",
                    "error"
                );

                if (
                    /categor|allocat|already assigned|already exist/i.test(
                        error.message || ""
                    )
                ) {
                    await loadCategories();
                }
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = "Create Department";
                }
            }
        });
    }

    $("#resetDepartmentForm")?.addEventListener("click", () => {
        departmentForm?.reset();
        clearFormMessage();
    });

    departmentSearch?.addEventListener("input", renderDepartments);
    departmentStatusFilter?.addEventListener("change", renderDepartments);

    $("#openAddDepartment")?.addEventListener("click", () => {
        $("#addDepartment")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        $("#departmentName")?.focus({ preventScroll: true });
    });

    // ---------------- COMPLAINT DETAILS MODAL ----------------

    function closeComplaintDetails() {
        const overlay = $("#adminComplaintDetailsModal");

        if (!overlay) return;

        overlay.hidden = true;
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");
        overlay.style.display = "none";

        document.body.classList.remove("modal-open");
    }

    function getImageSource(value) {
        if (typeof value !== "string" || !value.trim()) return "";

        const image = value.trim();

        if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(image)) {
            return image;
        }

        if (
            image.length > 100 &&
            /^[A-Za-z0-9+/=\r\n]+$/.test(image)
        ) {
            return `data:image/jpeg;base64,${image.replace(/\s/g, "")}`;
        }

        try {
            const url = new URL(image, `${API_BASE_URL}/`);

            if (url.protocol === "http:" || url.protocol === "https:") {
                return url.href;
            }
        } catch (error) {
            console.warn("Invalid complaint image URL:", error);
        }

        return "";
    }

    function ensureComplaintModal() {
        let overlay = $("#adminComplaintDetailsModal");

        if (overlay) {
            const closeButton = overlay.querySelector(
                ".complaint-details-close"
            );

            if (closeButton && !closeButton.dataset.closeBound) {
                closeButton.dataset.closeBound = "true";
                closeButton.addEventListener(
                    "click",
                    closeComplaintDetails
                );
            }

            if (!overlay.dataset.backdropBound) {
                overlay.dataset.backdropBound = "true";

                overlay.addEventListener("click", (event) => {
                    if (event.target === overlay) {
                        closeComplaintDetails();
                    }
                });
            }

            return overlay;
        }

        overlay = document.createElement("div");
        overlay.id = "adminComplaintDetailsModal";
        overlay.className = "complaint-details-overlay";
        overlay.hidden = true;
        overlay.setAttribute("hidden", "");
        overlay.setAttribute("aria-hidden", "true");

        const card = document.createElement("section");
        card.className = "complaint-details-card";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute(
            "aria-labelledby",
            "adminComplaintDetailsTitle"
        );

        const header = document.createElement("div");
        header.className = "complaint-details-header";

        const title = document.createElement("h2");
        title.id = "adminComplaintDetailsTitle";
        title.textContent = "Complaint Details";

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "complaint-details-close";
        closeButton.textContent = "×";
        closeButton.setAttribute(
            "aria-label",
            "Close complaint details"
        );
        closeButton.dataset.closeBound = "true";
        closeButton.addEventListener(
            "click",
            closeComplaintDetails
        );

        header.append(title, closeButton);

        const content = document.createElement("div");
        content.id = "adminComplaintDetailsContent";
        content.className = "complaint-details-content";

        card.append(header, content);
        overlay.appendChild(card);

        overlay.dataset.backdropBound = "true";
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                closeComplaintDetails();
            }
        });

        document.body.appendChild(overlay);

        return overlay;
    }

    function addComplaintDetail(container, labelText, value) {
        const row = document.createElement("div");
        row.className = "complaint-detail-row";

        const label = document.createElement("strong");
        label.className = "complaint-detail-label";
        label.textContent = labelText;

        const detail = document.createElement("div");
        detail.className = "complaint-detail-value";

        if (
            value &&
            typeof value === "object" &&
            !(value instanceof Date)
        ) {
            detail.textContent = JSON.stringify(value, null, 2);
        } else {
            detail.textContent =
                value === undefined || value === null || value === ""
                    ? "Not provided"
                    : String(value);
        }

        row.append(label, detail);
        container.appendChild(row);
    }

    function showComplaintDetails(request) {
        const overlay = ensureComplaintModal();
        const content = $("#adminComplaintDetailsContent");

        if (!content) return;

        content.replaceChildren();

        const rejection = request.rejection_request || {};
        const reassignment = getManualReassignment(request);

        const complaintId = String(
            firstValue(
                request,
                ["complaint_id", "report_id", "id", "_id"],
                "Unavailable"
            )
        );

        const complaintTitle = firstValue(
            request,
            [
                "title",
                "category",
                "ai_category",
                "predicted_class",
                "issue_type"
            ],
            "Civic Issue"
        );

        const description = firstValue(
            request,
            [
                "description",
                "issue_description",
                "details",
                "complaint_description"
            ],
            "No complaint description was provided."
        );

        const location = firstValue(
            request,
            ["location", "address", "issue_location"],
            "Not provided"
        );

        const category = firstValue(
            request,
            ["ai_category", "predicted_class", "category", "issue_type"],
            "Not classified"
        );

        const confidence = request.confidence;

        const confidenceText =
            confidence === undefined ||
            confidence === null ||
            confidence === ""
                ? "Not available"
                : (
                    Number(confidence) <= 1
                        ? `${(Number(confidence) * 100).toFixed(1)}%`
                        : `${Number(confidence).toFixed(1)}%`
                );

        // Every category the model found, with its score and how many
        // boxes backed it. This is what explains an unclassified photo.
        const detections = Array.isArray(request.ai_detections)
            ? request.ai_detections
            : null;

        const detectionText =
            detections === null
                ? "Not recorded (backend is running the old app.py)"
                : detections.length === 0
                    ? "Model found nothing in this photo"
                    : detections
                        .map((item) => {
                            const name =
                                (item && item.category) || "unknown";
                            const score = Number(item && item.confidence);
                            const boxes =
                                Number(item && item.detections) || 1;
                            const shown = Number.isFinite(score)
                                ? `${(score * 100).toFixed(1)}%`
                                : "?";

                            return `${name} ${shown} (${boxes} box`
                                + `${boxes === 1 ? "" : "es"})`;
                        })
                        .join(", ");

        // Which classifier produced the category on this complaint.
        const engine = String(request.ai_engine || "yolo").toLowerCase();
        const vision = request.ai_vision || null;

        const engineText =
            engine === "vision"
                ? "Vision fallback - the local model could not classify "
                    + "this photo"
                    + (vision && vision.reason ? ` (${vision.reason})` : "")
                : "Local YOLO model (best.pt)";

        const reportedBy = firstValue(
            request,
            ["name", "user_name", "full_name", "email"],
            "Not provided"
        );

        const department = firstValue(
            request,
            ["department_name", "department"],
            "Not assigned"
        );

        const reportStatus = firstValue(
            request,
            ["status"],
            "Not provided"
        );

        addComplaintDetail(content, "Complaint ID", complaintId);
        addComplaintDetail(content, "Issue", complaintTitle);
        addComplaintDetail(content, "Description", description);
        addComplaintDetail(content, "Location", location);
        addComplaintDetail(content, "AI category", category);
        addComplaintDetail(content, "AI confidence", confidenceText);
        addComplaintDetail(content, "What the model saw", detectionText);
        addComplaintDetail(content, "Decided by", engineText);
        addComplaintDetail(content, "Reported by", reportedBy);
        addComplaintDetail(content, "Assigned department", department);
        addComplaintDetail(content, "Current status", reportStatus);

        if (request.ai_review_status) {
            addComplaintDetail(
                content,
                "AI review status",
                request.ai_review_status
            );
        }

        const requestType = getReassignmentType(request);

        if (
            reassignment.reason ||
            reassignment.status ||
            request.request_label ||
            request.request_type
        ) {
            addComplaintDetail(
                content,
                "Request type",
                getReassignmentLabel(request)
            );

            addComplaintDetail(
                content,
                "Assignment reason",
                reassignment.reason ||
                    request.reassignment_reason ||
                    request.reason ||
                    "Not provided"
            );

            addComplaintDetail(
                content,
                "Requested by",
                reassignment.requested_by || "Not provided"
            );

            addComplaintDetail(
                content,
                "Assignment review status",
                reassignment.status || "Not provided"
            );

            if (reassignment.requested_at) {
                addComplaintDetail(
                    content,
                    "Request date",
                    formatDate(reassignment.requested_at)
                );
            }

            if (reassignment.assigned_department) {
                addComplaintDetail(
                    content,
                    "Assigned by admin to",
                    reassignment.assigned_department
                );
            }
        }

        const rejectionReason = firstValue(
            request,
            ["rejection_reason"],
            rejection.reason || "No rejection reason provided."
        );

        addComplaintDetail(
            content,
            "Department's rejection reason",
            rejectionReason
        );

        const reportedDate = firstValue(
            request,
            [
                "created_at",
                "createdAt",
                "submitted_at",
                "timestamp",
                "date"
            ],
            ""
        );

        if (reportedDate) {
            addComplaintDetail(
                content,
                "Reported on",
                formatDate(reportedDate)
            );
        }

        const imageValue = firstValue(
            request,
            [
                "image",
                "image_url",
                "imageUrl",
                "photo_url",
                "photo",
                "evidence_image",
                "image_data"
            ],
            ""
        );

        const imageSource = getImageSource(imageValue);
        const imageSection = document.createElement("div");
        imageSection.className = "complaint-detail-image-section";

        const imageHeading = document.createElement("strong");
        imageHeading.textContent = "Complaint Evidence";
        imageSection.appendChild(imageHeading);

        if (imageSource) {
            const image = document.createElement("img");
            image.className = "complaint-evidence-image";
            image.alt = "Image submitted with the complaint";
            image.loading = "lazy";
            image.src = imageSource;

            image.onerror = () => {
                image.replaceWith(
                    document.createTextNode(
                        "The image could not be displayed. The stored image may need a backend image URL."
                    )
                );
            };

            imageSection.appendChild(image);
        } else {
            const noImage = document.createElement("p");
            noImage.textContent =
                "No displayable complaint image was included in the API response.";
            imageSection.appendChild(noImage);
        }

        content.appendChild(imageSection);

        // ---------------- ADMIN DIRECT REJECTION ----------------

        const rejectionPanel = document.createElement("div");
        rejectionPanel.className = "admin-direct-rejection";

        const rejectionHeading = document.createElement("h3");
        rejectionHeading.textContent = "Admin Actions";

        const rejectionLabel = document.createElement("label");
        rejectionLabel.textContent = "Reason for rejection (required)";
        rejectionLabel.htmlFor = "adminDirectRejectionReason";

        const rejectionInput = document.createElement("textarea");
        rejectionInput.id = "adminDirectRejectionReason";
        rejectionInput.placeholder =
            "Explain why this complaint is being rejected...";
        rejectionInput.rows = 4;
        rejectionInput.maxLength = 1000;
        rejectionInput.required = true;

        const rejectionMessage = document.createElement("p");
        rejectionMessage.className = "admin-direct-rejection-message";
        rejectionMessage.setAttribute("role", "status");

        const rejectButton = document.createElement("button");
        rejectButton.type = "button";
        rejectButton.className = "admin-direct-reject-button";
        rejectButton.textContent = "Reject Complaint";

        if (String(reportStatus).trim().toLowerCase() === "rejected") {
            rejectionInput.disabled = true;
            rejectionInput.value = String(rejectionReason);
            rejectionMessage.textContent =
                "This complaint is already rejected.";
            rejectButton.disabled = true;
        }

        rejectButton.addEventListener("click", async () => {
            const reason = rejectionInput.value.trim();

            if (reason.length < 5) {
                rejectionMessage.textContent =
                    "Please enter a reason of at least 5 characters.";
                rejectionMessage.className =
                    "admin-direct-rejection-message error";
                rejectionInput.focus();
                return;
            }

            if (
                !window.confirm(
                    "Are you sure you want to reject this complaint? This action will update its status."
                )
            ) {
                return;
            }

            rejectButton.disabled = true;
            rejectionInput.disabled = true;
            rejectionMessage.textContent = "Rejecting complaint...";
            rejectionMessage.className =
                "admin-direct-rejection-message";

            try {
                const result = await apiFetch(
                    `/api/admin/reports/${encodeURIComponent(complaintId)}/reject`,
                    {
                        method: "POST",
                        body: JSON.stringify({ reason })
                    }
                );

                rejectionMessage.textContent =
                    result.message ||
                    "Complaint rejected successfully.";

                rejectionMessage.className =
                    "admin-direct-rejection-message success";

                alert(
                    result.message ||
                    "Complaint rejected successfully."
                );

                closeComplaintDetails();

                await Promise.all([
                    loadComplaintStatistics(),
                    loadRejectionRequests(),
                    loadReassignmentRequests()
                ]);
            } catch (error) {
                rejectionMessage.textContent = error.message;
                rejectionMessage.className =
                    "admin-direct-rejection-message error";

                rejectionInput.disabled = false;
                rejectButton.disabled = false;
            }
        });

        rejectionPanel.append(
            rejectionHeading,
            rejectionLabel,
            rejectionInput,
            rejectButton,
            rejectionMessage
        );

        content.appendChild(rejectionPanel);

        console.log(
            "Complaint details returned by the server:",
            request
        );

        overlay.hidden = false;
        overlay.removeAttribute("hidden");
        overlay.removeAttribute("aria-hidden");
        overlay.style.removeProperty("display");

        document.body.classList.add("modal-open");

        overlay.querySelector(".complaint-details-close")?.focus();
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        const overlay = $("#adminComplaintDetailsModal");

        if (overlay && !overlay.hidden) {
            closeComplaintDetails();
        }
    });

    // ---------------- REJECTION REQUESTS ----------------

    function normalizeRejectionStatus(request) {
        const status = String(
            request.rejection_status ||
            request.rejection_request?.status ||
            request.review_status ||
            "pending"
        ).trim().toLowerCase();

        if (["approved", "rejected"].includes(status)) {
            return "approved";
        }

        if (["disapproved", "denied"].includes(status)) {
            return "disapproved";
        }

        return "pending";
    }

    async function loadRejectionRequests() {
        showEmptyRow(
            rejectionTableBody,
            5,
            "Loading rejection requests..."
        );

        try {
            const data = await apiFetch("/api/admin/rejection-requests");

            rejectionRequests = Array.isArray(data.requests)
                ? data.requests
                : [];

            renderRejectionRequests();
        } catch (error) {
            console.error(
                "Rejection requests loading failed:",
                error
            );

            rejectionRequests = [];

            showEmptyRow(
                rejectionTableBody,
                5,
                `Could not load rejection requests: ${error.message}`
            );

            updateRejectionCounts([]);
        }
    }

    function updateRejectionCounts(filtered) {
        const pendingCount = rejectionRequests.filter(
            (request) =>
                normalizeRejectionStatus(request) === "pending"
        ).length;

        if ($("#pendingRejectionCount")) {
            $("#pendingRejectionCount").textContent =
                `${pendingCount} pending request${pendingCount === 1 ? "" : "s"}`;
        }

        if ($("#rejectionRequestResultCount")) {
            $("#rejectionRequestResultCount").textContent =
                `Showing ${filtered.length} of ${rejectionRequests.length} requests`;
        }
    }

    function renderRejectionRequests() {
        if (!rejectionTableBody) return;

        const searchTerm = String(
            rejectionSearch?.value || ""
        ).trim().toLowerCase();

        const selectedStatus = String(
            rejectionStatusFilter?.value || "pending"
        ).trim().toLowerCase();

        const filtered = rejectionRequests.filter((request) => {
            const complaintId = String(
                request.complaint_id ||
                request.report_id ||
                request.id ||
                ""
            );

            const department = String(
                request.department_name ||
                request.department ||
                ""
            );

            const reason = String(
                request.reason ||
                request.rejection_reason ||
                request.rejection_request?.reason ||
                ""
            );

            const status = normalizeRejectionStatus(request);

            return (
                [complaintId, department, reason].some(
                    (value) =>
                        value.toLowerCase().includes(searchTerm)
                ) &&
                (selectedStatus === "all" ||
                    selectedStatus === status)
            );
        });

        rejectionTableBody.replaceChildren();

        if (!filtered.length) {
            showEmptyRow(
                rejectionTableBody,
                5,
                rejectionRequests.length
                    ? "No rejection requests match your filters."
                    : "No rejection requests are available."
            );
        } else {
            filtered.forEach((request) => {
                const row = document.createElement("tr");
                const status = normalizeRejectionStatus(request);

                const reportId = String(
                    request.complaint_id ||
                    request.report_id ||
                    request.id ||
                    ""
                );

                const complaintCell = document.createElement("td");
                const complaintId = document.createElement("span");

                complaintId.className = "rejection-complaint-id";
                complaintId.textContent = reportId || "—";
                complaintCell.appendChild(complaintId);

                const departmentCell = createTextCell(
                    request.department_name ||
                    request.department ||
                    "—"
                );

                const reasonCell = document.createElement("td");
                const reason = document.createElement("span");

                reason.className = "rejection-reason";
                reason.textContent =
                    request.reason ||
                    request.rejection_reason ||
                    request.rejection_request?.reason ||
                    "No reason provided";

                reasonCell.appendChild(reason);

                const dateCell = document.createElement("td");
                dateCell.className = "rejection-date";
                dateCell.textContent = formatDate(
                    request.requested_at ||
                    request.rejection_request?.requested_at ||
                    request.created_at
                );

                const actionsCell = document.createElement("td");
                const actions = document.createElement("div");
                actions.className = "rejection-actions";

                const viewButton = document.createElement("button");
                viewButton.type = "button";
                viewButton.className = "view-complaint-button";
                viewButton.textContent = "View Complaint";

                viewButton.addEventListener("click", () => {
                    showComplaintDetails(request);
                });

                actions.appendChild(viewButton);

                if (status === "pending") {
                    const approveButton =
                        document.createElement("button");

                    approveButton.type = "button";
                    approveButton.className =
                        "approve-rejection-button";
                    approveButton.textContent = "Approve";

                    const disapproveButton =
                        document.createElement("button");

                    disapproveButton.type = "button";
                    disapproveButton.className =
                        "disapprove-rejection-button";
                    disapproveButton.textContent = "Disapprove";

                    approveButton.addEventListener("click", () => {
                        reviewRejectionRequest(
                            reportId,
                            "approve",
                            approveButton,
                            disapproveButton
                        );
                    });

                    disapproveButton.addEventListener("click", () => {
                        reviewRejectionRequest(
                            reportId,
                            "disapprove",
                            approveButton,
                            disapproveButton
                        );
                    });

                    actions.append(
                        approveButton,
                        disapproveButton
                    );
                } else {
                    actions.appendChild(
                        createBadge(
                            status === "approved"
                                ? "Approved"
                                : "Disapproved",
                            `rejection-status rejection-status-${status}`
                        )
                    );
                }

                actionsCell.appendChild(actions);

                row.append(
                    complaintCell,
                    departmentCell,
                    reasonCell,
                    dateCell,
                    actionsCell
                );

                rejectionTableBody.appendChild(row);
            });
        }

        updateRejectionCounts(filtered);
    }

    async function reviewRejectionRequest(
        reportId,
        decision,
        approveButton,
        disapproveButton
    ) {
        if (!reportId) {
            alert(
                "The complaint ID is missing. Please refresh the page."
            );
            return;
        }

        const decisionText =
            decision === "approve" ? "approve" : "disapprove";

        if (
            !window.confirm(
                `Are you sure you want to ${decisionText} this rejection request?`
            )
        ) {
            return;
        }

        approveButton.disabled = true;
        disapproveButton.disabled = true;

        try {
            await apiFetch(
                `/api/admin/rejection-requests/${encodeURIComponent(reportId)}/${decision}`,
                { method: "POST" }
            );

            alert(
                decision === "approve"
                    ? "Rejection request approved."
                    : "Rejection request disapproved. The complaint returns to Pending."
            );

            await Promise.all([
                loadRejectionRequests(),
                loadComplaintStatistics()
            ]);
        } catch (error) {
            console.error("Review rejection request:", error);

            alert(
                `Could not review the request: ${error.message}`
            );

            approveButton.disabled = false;
            disapproveButton.disabled = false;
        }
    }

    rejectionSearch?.addEventListener(
        "input",
        renderRejectionRequests
    );

    rejectionStatusFilter?.addEventListener(
        "change",
        renderRejectionRequests
    );

    // ---------------- MANUAL ASSIGNMENT / REASSIGNMENT ----------------

    function normalizeReassignmentStatus(request) {
        const reassignment = getManualReassignment(request);

        return String(
            reassignment.status ||
            request.reassignment_status ||
            request.reassignmentStatus ||
            "pending"
        ).trim().toLowerCase();
    }

    function getReassignmentId(request) {
        return String(
            request.complaint_id ||
            request.report_id ||
            request._id ||
            request.id ||
            ""
        );
    }

    async function loadReassignmentRequests() {
        showEmptyRow(
            reassignmentTableBody,
            6,
            "Loading manual assignment requests..."
        );

        try {
            const data = await apiFetch(
                "/api/admin/reassignment-requests"
            );

            reassignmentRequests = Array.isArray(data.requests)
                ? data.requests
                : Array.isArray(data.reports)
                    ? data.reports
                    : [];

            renderReassignmentRequests();
        } catch (error) {
            console.error(
                "Manual assignment requests loading failed:",
                error
            );

            reassignmentRequests = [];

            showEmptyRow(
                reassignmentTableBody,
                6,
                `Could not load assignment requests: ${error.message}`
            );

            updateReassignmentCounts([]);
        }
    }

    function updateReassignmentCounts(filtered) {
        const pendingCount = reassignmentRequests.filter(
            (request) =>
                normalizeReassignmentStatus(request) === "pending"
        ).length;

        if ($("#pendingReassignmentCount")) {
            $("#pendingReassignmentCount").textContent =
                `${pendingCount} pending request${pendingCount === 1 ? "" : "s"}`;
        }

        if ($("#reassignmentRequestResultCount")) {
            $("#reassignmentRequestResultCount").textContent =
                `Showing ${filtered.length} of ${reassignmentRequests.length} requests`;
        }
    }

    function renderReassignmentRequests() {
        if (!reassignmentTableBody) return;

        const searchTerm = String(
            reassignmentSearch?.value || ""
        ).trim().toLowerCase();

        const selectedStatus = String(
            reassignmentStatusFilter?.value || "pending"
        ).trim().toLowerCase();

        const filtered = reassignmentRequests.filter((request) => {
            const id = getReassignmentId(request).toLowerCase();
            const reassignment = getManualReassignment(request);
            const requestLabel = getReassignmentLabel(request);

            const currentDepartment = String(
                firstValue(
                    request,
                    ["previous_department", "department_name", "department"],
                    reassignment.previous_department || "Not assigned"
                )
            );

            const reasonText = String(
                reassignment.reason ||
                request.reassignment_reason ||
                request.reason ||
                "No reason provided"
            );

            const category = String(
                request.ai_category ||
                request.category ||
                "Unclassified"
            );

            const status = normalizeReassignmentStatus(request);

            const matchesSearch = [
                id,
                currentDepartment,
                reasonText,
                requestLabel,
                category
            ].some((value) =>
                value.toLowerCase().includes(searchTerm)
            );

            const matchesStatus =
                selectedStatus === "all" ||
                (selectedStatus === "pending" && status === "pending") ||
                (
                    selectedStatus === "assigned" &&
                    ["assigned", "approved", "completed"].includes(status)
                );

            return matchesSearch && matchesStatus;
        });

        reassignmentTableBody.replaceChildren();

        if (!filtered.length) {
            showEmptyRow(
                reassignmentTableBody,
                6,
                reassignmentRequests.length
                    ? "No assignment requests match your filters."
                    : "No manual assignments or department reassignments are waiting for review."
            );
        } else {
            filtered.forEach((request) => {
                const row = document.createElement("tr");

                const id = getReassignmentId(request);
                const reassignment = getManualReassignment(request);
                const status = normalizeReassignmentStatus(request);
                const requestType = getReassignmentType(request);
                const requestLabel = getReassignmentLabel(request);

                const currentDepartment = String(
                    firstValue(
                        request,
                        ["previous_department", "department_name", "department"],
                        reassignment.previous_department || "Not assigned"
                    )
                );

                const reasonText = String(
                    reassignment.reason ||
                    request.reassignment_reason ||
                    request.reason ||
                    "No reason provided"
                );

                const requestedAt =
                    request.requested_at ||
                    reassignment.requested_at ||
                    request.created_at;

                // Complaint ID and request type
                const complaintCell = document.createElement("td");

                const idText = document.createElement("span");
                idText.className = "rejection-complaint-id";
                idText.textContent = id || "—";

                const typeBadge = createBadge(
                    requestLabel,
                    requestType === "manual_assignment"
                        ? "rejection-status rejection-status-pending"
                        : "admin-status"
                );

                const idWrapper = document.createElement("div");
                idWrapper.className = "manual-assignment-id-cell";
                idWrapper.append(idText, typeBadge);

                complaintCell.appendChild(idWrapper);

                // Current department
                const departmentCell = createTextCell(
                    currentDepartment
                );

                // Reason
                const reasonCell = document.createElement("td");
                const reason = document.createElement("span");

                reason.className = "rejection-reason";
                reason.textContent = reasonText;

                reasonCell.appendChild(reason);

                // Request date
                const dateCell = createTextCell(
                    formatDate(requestedAt)
                );

                // Department selection
                const assignCell = document.createElement("td");
                const departmentSelect =
                    document.createElement("select");

                departmentSelect.className =
                    "reassignment-department-select";

                departmentSelect.setAttribute(
                    "aria-label",
                    `Choose department for complaint ${id}`
                );

                const placeholder = document.createElement("option");
                placeholder.value = "";
                placeholder.textContent = "Choose department";
                departmentSelect.appendChild(placeholder);

                const activeDepartments = departments.filter(
                    (department) =>
                        normalizeStatus(department.status) === "active"
                );

                activeDepartments.forEach((department) => {
                    const option = document.createElement("option");

                    option.value = department.name;
                    option.textContent = department.name;

                    departmentSelect.appendChild(option);
                });

                // Actions
                const actionsCell = document.createElement("td");
                const actions = document.createElement("div");
                actions.className = "rejection-actions";

                const viewButton = document.createElement("button");
                viewButton.type = "button";
                viewButton.className = "view-complaint-button";
                viewButton.textContent = "View";

                viewButton.addEventListener("click", () => {
                    showComplaintDetails(request);
                });

                actions.appendChild(viewButton);

                if (status === "pending") {
                    const assignButton =
                        document.createElement("button");

                    assignButton.type = "button";
                    assignButton.className =
                        "approve-rejection-button";
                    assignButton.textContent =
                        requestType === "manual_assignment"
                            ? "Assign Department"
                            : "Reassign";

                    assignButton.disabled =
                        activeDepartments.length === 0;

                    assignButton.addEventListener(
                        "click",
                        async () => {
                            const targetDepartment =
                                departmentSelect.value;

                            if (!id || id === "Unavailable") {
                                alert(
                                    "The complaint ID is missing. Refresh the page and try again."
                                );
                                return;
                            }

                            if (!targetDepartment) {
                                alert(
                                    "Please choose an active department before assigning this complaint."
                                );

                                departmentSelect.focus();
                                return;
                            }

                            if (
                                requestType === "department_reassignment" &&
                                currentDepartment !== "Not assigned" &&
                                targetDepartment.toLowerCase() ===
                                    currentDepartment.toLowerCase()
                            ) {
                                alert(
                                    "Choose a department different from the current department."
                                );

                                departmentSelect.focus();
                                return;
                            }

                            const actionVerb =
                                requestType === "manual_assignment"
                                    ? "assign"
                                    : "reassign";

                            if (
                                !window.confirm(
                                    `${actionVerb.charAt(0).toUpperCase() + actionVerb.slice(1)} complaint ${id} to "${targetDepartment}"?`
                                )
                            ) {
                                return;
                            }

                            assignButton.disabled = true;
                            departmentSelect.disabled = true;
                            assignButton.textContent = "Saving...";

                            try {
                                const result = await apiFetch(
                                    `/api/admin/reports/${encodeURIComponent(id)}/assign-department`,
                                    {
                                        method: "POST",
                                        body: JSON.stringify({
                                            department_name:
                                                targetDepartment
                                        })
                                    }
                                );

                                alert(
                                    result.message ||
                                    `Complaint assigned to ${targetDepartment}.`
                                );

                                await Promise.all([
                                    loadReassignmentRequests(),
                                    loadDepartments(),
                                    loadComplaintStatistics()
                                ]);
                            } catch (error) {
                                console.error(
                                    "Manual department assignment:",
                                    error
                                );

                                alert(
                                    `Could not assign complaint: ${error.message}`
                                );

                                assignButton.disabled = false;
                                departmentSelect.disabled = false;
                                assignButton.textContent =
                                    requestType === "manual_assignment"
                                        ? "Assign Department"
                                        : "Reassign";
                            }
                        }
                    );

                    actions.appendChild(assignButton);
                } else {
                    const assignedDepartment =
                        reassignment.assigned_department ||
                        request.department_name ||
                        request.department ||
                        "";

                    actions.appendChild(
                        createBadge(
                            assignedDepartment
                                ? `Assigned: ${assignedDepartment}`
                                : "Already assigned",
                            "rejection-status rejection-status-approved"
                        )
                    );

                    departmentSelect.disabled = true;
                }

                assignCell.appendChild(departmentSelect);
                actionsCell.appendChild(actions);

                row.append(
                    complaintCell,
                    departmentCell,
                    reasonCell,
                    dateCell,
                    assignCell,
                    actionsCell
                );

                reassignmentTableBody.appendChild(row);
            });
        }

        updateReassignmentCounts(filtered);
    }

    reassignmentSearch?.addEventListener(
        "input",
        renderReassignmentRequests
    );

    reassignmentStatusFilter?.addEventListener(
        "change",
        renderReassignmentRequests
    );

    // ---------------- REFRESH ----------------

    $("#refreshButton")?.addEventListener("click", async () => {
        await Promise.all([
            loadDepartments(),
            loadComplaintStatistics(),
            loadCategories(),
            loadRejectionRequests(),
            loadReassignmentRequests()
        ]);
    });

    // ---------------- LOGOUT ----------------

    $("#logoutButton")?.addEventListener("click", async () => {
        try {
            await apiFetch("/api/logout", {
                method: "POST"
            });
        } catch (error) {
            console.warn("Server logout failed:", error);
        }

        sessionStorage.removeItem("civicfixUser");
        window.location.href = "login.html";
    });

    // ---------------- INITIAL PAGE LOAD ----------------

    loadCategories();
    loadDepartments();
    loadComplaintStatistics();
    loadRejectionRequests();
    loadReassignmentRequests();
});
