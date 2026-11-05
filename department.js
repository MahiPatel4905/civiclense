
const API_BASE_URL = "http://127.0.0.1:5000";

const state = {
  complaints: [],
  selectedComplaint: null,
  wrongDepartmentButton: null,
  loading: false
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initializeDashboard);

async function initializeDashboard() {
  $("currentYear").textContent = new Date().getFullYear();

  $("currentDate").textContent = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  setupEventListeners();
  await verifyDepartmentAndLoad();
}

function setupEventListeners() {
  $("refreshButton").addEventListener("click", loadComplaints);
  $("complaintSearch").addEventListener("input", renderComplaints);
  $("statusFilter").addEventListener("change", renderComplaints);
  $("logoutButton").addEventListener("click", logout);

  $("mobileMenuButton").addEventListener("click", () => {
    const sidebar = $("sidebar");
    const isOpen = sidebar.classList.toggle("open");
    $("mobileMenuButton").setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", (event) => {
    const sidebar = $("sidebar");

    if (
      window.innerWidth <= 760 &&
      sidebar.classList.contains("open") &&
      !sidebar.contains(event.target) &&
      !$("mobileMenuButton").contains(event.target)
    ) {
      sidebar.classList.remove("open");
      $("mobileMenuButton").setAttribute("aria-expanded", "false");
    }
  });

  $("closeRejectionModal").addEventListener("click", closeRejectionModal);
  $("cancelRejection").addEventListener("click", closeRejectionModal);

  $("rejectionModal").addEventListener("click", (event) => {
    if (event.target === $("rejectionModal")) {
      closeRejectionModal();
    }
  });

  $("closeWrongDepartmentModal").addEventListener(
    "click",
    closeWrongDepartmentModal
  );

  $("cancelWrongDepartment").addEventListener(
    "click",
    closeWrongDepartmentModal
  );

  $("confirmWrongDepartment").addEventListener(
    "click",
    confirmWrongDepartment
  );

  $("wrongDepartmentModal").addEventListener("click", (event) => {
    if (event.target === $("wrongDepartmentModal")) {
      closeWrongDepartmentModal();
    }
  });

  $("closeDetailsModal").addEventListener("click", closeDetailsModal);

  $("complaintDetailsModal").addEventListener("click", (event) => {
    if (event.target === $("complaintDetailsModal")) {
      closeDetailsModal();
    }
  });

  $("rejectionReason").addEventListener("change", updateRejectionFields);

  $("rejectionExplanation").addEventListener("input", () => {
    $("reasonCharacterCount").textContent =
      $("rejectionExplanation").value.length;
  });

  $("rejectionForm").addEventListener("submit", submitRejectionRequest);
  $("complaintList").addEventListener("click", handleComplaintAction);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeRejectionModal();
      closeDetailsModal();
      closeWrongDepartmentModal();
    }
  });
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };

  if (!response.ok) {
    const error = new Error(
      data.error || data.message || `Request failed (${response.status})`
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

async function verifyDepartmentAndLoad() {
  try {
    const data = await apiRequest("/api/me");
    const user = data.user || data;
    const role = String(user.role || user.user_type || "").toLowerCase();

    if (role !== "department") {
      showPageMessage(
        "Please sign in using your department account.",
        "error"
      );

      setTimeout(() => {
        window.location.href = "login.html";
      }, 1200);

      return;
    }

    displayDepartmentInfo(user);
    await loadComplaints();
  } catch (error) {
    console.error("Department authentication failed:", error);

    if (error.status === 401 || error.status === 403) {
      window.location.href = "login.html";
      return;
    }

    showPageMessage(
      "Unable to verify your account. Check the backend and refresh.",
      "error"
    );
  }
}

function displayDepartmentInfo(user) {
  const name =
    user.department_name ||
    user.name ||
    user.department ||
    "Department";

  $("departmentName").textContent = name;
  $("departmentEmail").textContent =
    user.email || user.department_email || "";

  $("departmentAvatar").textContent =
    name.trim().charAt(0).toUpperCase() || "D";
}

async function loadComplaints() {
  if (state.loading) return;

  state.loading = true;
  $("refreshButton").disabled = true;
  $("loadingState").hidden = false;
  $("emptyState").hidden = true;
  $("complaintList").replaceChildren();

  try {
    const data = await apiRequest("/api/department/reports");

    const reports = Array.isArray(data)
      ? data
      : data.reports || data.complaints || data.data || [];

    state.complaints = reports.map(normalizeComplaint);

    updateStatistics();
    renderComplaints();
    renderMiniLists();
    clearPageMessage();
  } catch (error) {
    console.error("Could not load complaints:", error);

    showPageMessage(
      error.status === 401 || error.status === 403
        ? "Your department session has expired. Please sign in again."
        : "Could not load complaints. Check the backend and try again.",
      "error"
    );

    if (error.status === 401 || error.status === 403) {
      setTimeout(() => {
        window.location.href = "login.html";
      }, 1200);
    }
  } finally {
    state.loading = false;
    $("loadingState").hidden = true;
    $("refreshButton").disabled = false;
  }
}

function normalizeComplaint(report) {
  const id = String(
    report._id ||
    report.id ||
    report.report_id ||
    report.complaint_id ||
    ""
  );

  const rawStatus = String(
    report.status || report.complaint_status || "pending"
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");

  const rejectionStatus = String(
    report.rejection_request?.status ||
    report.rejection_status ||
    report.rejectionStatus ||
    ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");

  const rejectionRequested =
    rawStatus.includes("rejection_requested") ||
    rawStatus === "pending_rejection" ||
    rawStatus === "rejected_pending_approval" ||
    rejectionStatus === "pending" ||
    rejectionStatus === "pending_approval";

  return {
    ...report,
    id,

    title:
      report.ai_category ||
      report.issue_type ||
      report.predicted_class ||
      report.category ||
      report.issue ||
      report.title ||
      "Reported issue",

    description:
      report.description ||
      report.details ||
      report.issue_description ||
      "No description provided.",

    status: normalizeStatus(rawStatus, rejectionRequested),

    location:
      report.location ||
      report.address ||
      report.landmark ||
      "Location not provided",

    date:
      report.created_at ||
      report.createdAt ||
      report.timestamp ||
      report.date ||
      null,

    image:
      report.image_url ||
      report.image ||
      report.photo_url ||
      report.photo ||
      "",

    rejectionReason:
      report.rejection_reason ||
      report.rejectionReason ||
      "",

    rejectionRequestStatus: String(
      report.rejection_request?.status ||
      report.rejection_status ||
      report.rejectionStatus ||
      ""
    ).trim().toLowerCase().replace(/[\s-]+/g, "_"),

    adminNote:
      report.rejection_request?.admin_note ||
      report.rejection_request?.review_note ||
      "",

    rejectionReviewedAt:
      report.rejection_request?.reviewed_at || null,

    rejectionRequested,
    original: report
  };
}

function normalizeStatus(status, rejectionRequested = false) {
  if (rejectionRequested) return "rejection_requested";

  if (
    ["in_progress", "progress", "processing", "work_started"].includes(status)
  ) {
    return "in_progress";
  }

  if (status === "accepted") return "in_progress";

  if (["completed", "resolved", "closed", "fixed"].includes(status)) {
    return "completed";
  }

  if (["rejected", "declined"].includes(status)) return "rejected";

  if (
    ["pending", "new", "submitted", "open", "awaiting_review"].includes(status)
  ) {
    return "pending";
  }

  return status || "pending";
}

function updateStatistics() {
  const complaints = state.complaints;

  $("totalComplaints").textContent = complaints.length;
  $("pendingComplaints").textContent =
    complaints.filter((item) => item.status === "pending").length;
  $("inProgressComplaints").textContent =
    complaints.filter((item) => item.status === "in_progress").length;
  $("completedComplaints").textContent =
    complaints.filter((item) => item.status === "completed").length;
}

function renderComplaints() {
  const query = $("complaintSearch").value.trim().toLowerCase();
  const statusFilter = $("statusFilter").value;

  const filtered = state.complaints.filter((item) => {
    const searchableText = [
      item.id,
      item.title,
      item.description,
      item.location
    ].join(" ").toLowerCase();

    return (
      searchableText.includes(query) &&
      (statusFilter === "all" || item.status === statusFilter)
    );
  });

  $("complaintResultCount").textContent =
    `${filtered.length} complaint${filtered.length === 1 ? "" : "s"}`;

  $("complaintList").replaceChildren();
  $("emptyState").hidden = filtered.length !== 0;

  filtered.forEach((item) => {
    $("complaintList").appendChild(createComplaintCard(item));
  });
}

function createComplaintCard(item) {
  const card = document.createElement("article");
  card.className = "complaint-card";

  const header = document.createElement("div");
  header.className = "complaint-card-header";

  const titleGroup = document.createElement("div");
  titleGroup.className = "complaint-title-group";

  const id = document.createElement("span");
  id.className = "complaint-id";
  id.textContent = `Complaint ID: ${item.id || "Unavailable"}`;

  const title = document.createElement("h3");
  title.className = "complaint-title";
  title.textContent = item.title;

  titleGroup.append(id, title);

  const status = document.createElement("span");
  status.className = `status-badge ${getStatusClass(item.status)}`;
  status.textContent = getStatusLabel(item.status);

  header.append(titleGroup, status);

  const description = document.createElement("p");
  description.className = "complaint-description";
  description.textContent = item.description;

  const meta = document.createElement("div");
  meta.className = "complaint-meta";

  const location = document.createElement("span");
  location.textContent = `⌖ ${item.location}`;
  meta.appendChild(location);

  const formattedDate = getValidDateLabel(item.date);

  if (formattedDate) {
    const date = document.createElement("span");
    date.textContent = `Reported: ${formattedDate}`;
    meta.appendChild(date);
  }

  const actions = document.createElement("div");
  actions.className = "complaint-actions";

  actions.appendChild(
    createButton("View Details", "button-secondary", "details", item.id)
  );

  if (item.status === "pending") {
    actions.append(
      createButton("Accept", "button-primary", "accept", item.id),
      createButton(
        "Wrong Department",
        "button-secondary",
        "wrong-department",
        item.id
      ),
      createButton("Reject Request", "button-danger", "reject", item.id)
    );
  } else if (item.status === "in_progress") {
    actions.appendChild(
      createButton(
        "Mark as Completed",
        "button-primary",
        "complete",
        item.id
      )
    );
  } else if (item.status === "rejection_requested") {
    const note = document.createElement("p");
    note.className = "complaint-description";
    note.textContent = "Rejection request sent to admin for review.";
    actions.appendChild(note);
  }

  if (item.status === "rejected" && item.rejectionReason) {
    const reason = document.createElement("p");
    reason.className = "complaint-description";
    reason.textContent = `Rejection reason: ${item.rejectionReason}`;
    actions.appendChild(reason);
  }

  card.append(header, description, meta, actions);
  return card;
}

function createButton(label, className, action, complaintId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.dataset.complaintId = complaintId;
  button.textContent = label;
  return button;
}

function handleComplaintAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const complaint = state.complaints.find(
    (item) => item.id === button.dataset.complaintId
  );

  if (!complaint) {
    showPageMessage("Complaint not found. Refresh the dashboard.", "error");
    return;
  }

  if (button.dataset.action === "details") {
    openDetailsModal(complaint);
  } else if (button.dataset.action === "accept") {
    acceptComplaint(complaint, button);
  } else if (button.dataset.action === "wrong-department") {
    requestWrongDepartment(complaint, button);
  } else if (button.dataset.action === "reject") {
    openRejectionModal(complaint);
  } else if (button.dataset.action === "complete") {
    completeComplaint(complaint, button);
  }
}

/* WRONG DEPARTMENT / ADMIN REASSIGNMENT */

function requestWrongDepartment(complaint, button) {
  if (complaint.status !== "pending") {
    showPageMessage(
      "Only pending complaints can be sent for reassignment.",
      "error"
    );
    return;
  }

  state.selectedComplaint = complaint;
  state.wrongDepartmentButton = button;

  const message = $("wrongDepartmentFormMessage");
  message.hidden = true;
  message.textContent = "";

  $("confirmWrongDepartment").disabled = false;
  $("confirmWrongDepartment").textContent = "Confirm Reassignment";

  $("wrongDepartmentModal").hidden = false;
  document.body.classList.add("modal-open");

  $("confirmWrongDepartment").focus();
}

function closeWrongDepartmentModal() {
  $("wrongDepartmentModal").hidden = true;

  if (
    $("rejectionModal").hidden &&
    $("complaintDetailsModal").hidden
  ) {
    document.body.classList.remove("modal-open");
  }

  state.selectedComplaint = null;
  state.wrongDepartmentButton = null;
}

async function confirmWrongDepartment() {
  const complaint = state.selectedComplaint;
  const originalButton = state.wrongDepartmentButton;
  const confirmButton = $("confirmWrongDepartment");
  const message = $("wrongDepartmentFormMessage");

  if (!complaint) {
    message.textContent = "Please select a complaint first.";
    message.className = "confirm-feedback";
    message.hidden = false;
    return;
  }

  confirmButton.disabled = true;
  confirmButton.textContent = "Sending...";

  if (originalButton) originalButton.disabled = true;

  try {
    await apiRequest(
      `/api/department/reports/${encodeURIComponent(complaint.id)}/wrong-department`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: "Complaint requires manual department reassignment."
        })
      }
    );

    closeWrongDepartmentModal();

    showPageMessage(
      "Complaint sent to Admin for manual reassignment.",
      "success"
    );

    await loadComplaints();
  } catch (error) {
    console.error("Wrong department request failed:", error);

    message.textContent =
      error.message || "Could not send the complaint for reassignment.";

    message.className = "confirm-feedback";
    message.hidden = false;

    confirmButton.disabled = false;
    confirmButton.textContent = "Confirm Reassignment";

    if (originalButton) originalButton.disabled = false;
  }
}

/* ACCEPT AND COMPLETE COMPLAINTS */

async function acceptComplaint(complaint, button) {
  if (complaint.status !== "pending") {
    showPageMessage("Only pending complaints can be accepted.", "error");
    return;
  }

  if (!window.confirm("Accept this complaint and change it to In Progress?")) {
    return;
  }

  button.disabled = true;

  try {
    await apiRequest(
      `/api/department/reports/${encodeURIComponent(complaint.id)}/accept`,
      { method: "POST", body: JSON.stringify({}) }
    );

    showPageMessage("Complaint accepted successfully.", "success");
    await loadComplaints();
  } catch (error) {
    console.error("Accept complaint failed:", error);

    showPageMessage(
      error.message || "Could not accept this complaint.",
      "error"
    );

    button.disabled = false;
  }
}

async function completeComplaint(complaint, button) {
  if (complaint.status !== "in_progress") {
    showPageMessage(
      "Only complaints in progress can be marked completed.",
      "error"
    );
    return;
  }

  if (!window.confirm("Mark this complaint as completed?")) return;

  button.disabled = true;
  button.textContent = "Updating...";

  try {
    await apiRequest(
      `/api/department/reports/${encodeURIComponent(complaint.id)}/complete`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );

    showPageMessage(
      "Complaint marked as completed successfully.",
      "success"
    );

    await loadComplaints();
  } catch (error) {
    console.error("Complete complaint failed:", error);

    showPageMessage(
      error.message || "Could not mark this complaint as completed.",
      "error"
    );

    button.disabled = false;
    button.textContent = "Mark as Completed";
  }
}

/* REJECTION REQUEST */

function updateRejectionFields() {
  const reason = $("rejectionReason").value;
  const explanation = $("rejectionExplanation");
  const requiredMark = $("explanationRequiredMark");

  const isOther = reason === "Other";

  explanation.required = isOther;
  requiredMark.hidden = !isOther;

  explanation.placeholder = isOther
    ? "Please explain why this complaint should be rejected..."
    : "Add any extra details for the admin (optional)...";
}

function openRejectionModal(complaint) {
  if (complaint.status !== "pending") {
    showPageMessage(
      "Only pending complaints can be submitted for rejection.",
      "error"
    );
    return;
  }

  state.selectedComplaint = complaint;

  $("rejectionForm").reset();
  $("reasonCharacterCount").textContent = "0";
  $("rejectionFormMessage").hidden = true;

  updateRejectionFields();

  $("rejectionModal").hidden = false;
  document.body.classList.add("modal-open");
  $("rejectionReason").focus();
}

function closeRejectionModal() {
  $("rejectionModal").hidden = true;

  if (
    $("complaintDetailsModal").hidden &&
    $("wrongDepartmentModal").hidden
  ) {
    document.body.classList.remove("modal-open");
  }

  state.selectedComplaint = null;
}

async function submitRejectionRequest(event) {
  event.preventDefault();

  const complaint = state.selectedComplaint;
  const reason = $("rejectionReason").value.trim();
  const explanation = $("rejectionExplanation").value.trim();
  const submitButton = $("submitRejection");

  if (!complaint) {
    showModalMessage("Please select a complaint first.", "error");
    return;
  }

  if (!reason) {
    showModalMessage("Please select a rejection reason.", "error");
    $("rejectionReason").focus();
    return;
  }

  if (reason === "Other" && explanation.length < 5) {
    showModalMessage(
      "Please explain the reason using at least 5 characters.",
      "error"
    );
    $("rejectionExplanation").focus();
    return;
  }

  if (complaint.status !== "pending") {
    showModalMessage("This complaint is no longer pending.", "error");
    return;
  }

  const fullReason = explanation
    ? `${reason} — ${explanation}`
    : reason;

  submitButton.disabled = true;
  submitButton.textContent = "Sending...";

  try {
    await apiRequest(
      `/api/department/reports/${encodeURIComponent(complaint.id)}/reject-request`,
      {
        method: "POST",
        body: JSON.stringify({
          reason: fullReason,
          category: reason,
          explanation
        })
      }
    );

    closeRejectionModal();

    showPageMessage(
      "Rejection request sent to admin for review.",
      "success"
    );

    await loadComplaints();
  } catch (error) {
    console.error("Rejection request failed:", error);

    showModalMessage(
      error.message || "Could not send the rejection request.",
      "error"
    );
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Send to Admin";
  }
}

/* COMPLAINT DETAILS */

function openDetailsModal(complaint) {
  const container = $("complaintDetailsContent");
  container.replaceChildren();
  container.className = "details-content";

  addDetailRow(container, "Complaint ID", complaint.id || "Unavailable");
  addDetailRow(container, "Issue type", complaint.title);
  addDetailRow(container, "Description", complaint.description);
  addDetailRow(container, "Location", complaint.location);
  addDetailRow(container, "Status", getStatusLabel(complaint.status));

  const dateLabel = getValidDateLabel(complaint.date);
  if (dateLabel) addDetailRow(container, "Reported on", dateLabel);

  if (complaint.rejectionReason) {
    addDetailRow(container, "Rejection reason", complaint.rejectionReason);
  }

  if (complaint.rejectionRequestStatus === "approved") {
    addDetailRow(container, "Admin decision", "Rejection Approved");
  } else if (complaint.rejectionRequestStatus === "disapproved") {
    addDetailRow(container, "Admin decision", "Rejection Disapproved");
  }

  if (complaint.adminNote) {
    addDetailRow(container, "Admin note", complaint.adminNote);
  }

  if (complaint.rejectionReviewedAt) {
    const reviewDate = getValidDateLabel(complaint.rejectionReviewedAt);

    if (reviewDate) {
      addDetailRow(container, "Reviewed on", reviewDate);
    }
  }

  const imageSource = getImageSource(complaint.image);

  if (imageSource) {
    const row = document.createElement("div");
    row.className = "details-row";

    const label = document.createElement("strong");
    label.textContent = "Complaint image";

    const image = document.createElement("img");
    image.alt = "Complaint evidence";
    image.loading = "lazy";
    image.style.display = "block";
    image.style.maxWidth = "100%";
    image.style.maxHeight = "360px";
    image.style.objectFit = "contain";
    image.style.borderRadius = "12px";
    image.style.marginTop = "8px";

    image.onerror = () => {
      const errorMessage = document.createElement("p");
      errorMessage.textContent =
        "The stored complaint image could not be displayed.";
      image.replaceWith(errorMessage);
    };

    image.src = imageSource;
    row.append(label, image);
    container.appendChild(row);
  }

  $("complaintDetailsModal").hidden = false;
  document.body.classList.add("modal-open");
}

function getImageSource(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  const image = value.trim();

  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(image)) {
    return image;
  }

  if (/^[A-Za-z0-9+/=\r\n]+$/.test(image) && image.length > 100) {
    return `data:image/jpeg;base64,${image.replace(/\s/g, "")}`;
  }

  try {
    const url = new URL(image, window.location.href);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch {
    // Unsupported image source.
  }

  return "";
}

function addDetailRow(container, labelText, valueText) {
  const row = document.createElement("div");
  row.className = "details-row";

  const label = document.createElement("strong");
  label.textContent = labelText;

  const value = document.createElement("p");
  value.textContent = String(valueText || "Not provided");

  row.append(label, value);
  container.appendChild(row);
}

function closeDetailsModal() {
  $("complaintDetailsModal").hidden = true;

  if (
    $("rejectionModal").hidden &&
    $("wrongDepartmentModal").hidden
  ) {
    document.body.classList.remove("modal-open");
  }
}

/* MINI LISTS */

function renderMiniLists() {
  renderMiniList(
    $("inProgressList"),
    state.complaints.filter((item) => item.status === "in_progress"),
    "No complaints are currently in progress."
  );

  renderMiniList(
    $("completedList"),
    state.complaints.filter((item) => item.status === "completed"),
    "No completed complaints yet."
  );
}

function renderMiniList(container, complaints, emptyMessage) {
  container.replaceChildren();

  if (!complaints.length) {
    const empty = document.createElement("div");
    empty.className = "mini-empty";
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }

  complaints.forEach((complaint) => {
    const row = document.createElement("div");
    row.className = "mini-complaint";

    const info = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = complaint.title;

    const id = document.createElement("span");
    id.textContent = `Complaint ID: ${complaint.id || "Unavailable"}`;

    info.append(title, id);

    const badge = document.createElement("span");
    badge.className = `status-badge ${getStatusClass(complaint.status)}`;
    badge.textContent = getStatusLabel(complaint.status);

    row.append(info, badge);
    container.appendChild(row);
  });
}

/* LABELS, MESSAGES AND UTILITIES */

function getStatusLabel(status) {
  const labels = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    rejected: "Rejected",
    rejection_requested: "Rejection Requested"
  };

  return labels[status] || titleCase(status);
}

function getStatusClass(status) {
  const classes = {
    pending: "status-pending",
    in_progress: "status-in-progress",
    completed: "status-completed",
    rejected: "status-rejected",
    rejection_requested: "status-rejection-requested"
  };

  return classes[status] || "status-unknown";
}

function titleCase(value) {
  return String(value || "Unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getValidDateLabel(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function showPageMessage(message, type = "info") {
  const element = $("pageMessage");
  element.textContent = message;
  element.className = `feedback-message ${type}`;
  element.hidden = false;
}

function clearPageMessage() {
  $("pageMessage").hidden = true;
  $("pageMessage").textContent = "";
}

function showModalMessage(message, type = "error") {
  const element = $("rejectionFormMessage");
  element.textContent = message;
  element.className = `modal-feedback ${type}`;
  element.hidden = false;
}

/* LOGOUT */

async function logout() {
  const button = $("logoutButton");
  button.disabled = true;

  try {
    await apiRequest("/api/logout", { method: "POST" });
  } catch (error) {
    console.warn("Logout request failed:", error);
  } finally {
    sessionStorage.removeItem("civicfixUser");
    window.location.href = "login.html";
  }
}
