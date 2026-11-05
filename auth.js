/* =========================================
   CIVICFIX AI — LOGIN INTERACTIONS
   Connected to Flask + MongoDB
========================================= */

document.addEventListener("DOMContentLoaded", () => {
    const page = document.querySelector(".auth-page");
    const loginForm = document.getElementById("loginForm");

    const roleSelector = document.getElementById("roleSelector");
    const roleInputs = document.querySelectorAll('input[name="role"]');

    const roleBadgeText = document.getElementById("roleBadgeText");
    const loginHeading = document.getElementById("loginHeading");
    const loginDescription = document.getElementById("loginDescription");
    const submitButtonText = document.getElementById("submitButtonText");

    const signupPrompt = document.getElementById("signupPrompt");
    const adminAccessLink = document.getElementById("adminAccessLink");
    const forgotPasswordLink = document.getElementById("forgotPasswordLink");

    const formMessage = document.getElementById("formMessage");
    const authYear = document.getElementById("authYear");

    const asideHeading = document.getElementById("asideHeading");
    const asideDescription = document.getElementById("asideDescription");
    const illustrationTitle = document.getElementById("illustrationTitle");
    const illustrationDescription =
        document.getElementById("illustrationDescription");

    const stepOne = document.getElementById("stepOne");
    const stepTwo = document.getElementById("stepTwo");
    const stepThree = document.getElementById("stepThree");

    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const submitButton = loginForm?.querySelector('button[type="submit"], button:not([type])');

    const API_BASE_URL = "http://127.0.0.1:5000";

    let adminMode = false;
    let isLoggingIn = false;

    const portalContent = {
        user: {
            badge: "CITIZEN PORTAL",
            heading: "Citizen Sign In",
            description:
                "Report local issues, upload photos, and track your complaints from one place.",
            button: "Sign in as Citizen",
            asideHeading: "Your city. Your voice. Your impact.",
            asideDescription:
                "Report civic problems, follow progress, and help local issues reach the right team.",
            illustrationTitle: "Report received",
            illustrationDescription: "Your issue starts here",
            steps: ["REPORT", "TRACK", "RESOLVE"]
        },

        department: {
            badge: "DEPARTMENT PORTAL",
            heading: "Department Sign In",
            description:
                "Access assigned complaints, review issue details, and update resolution progress.",
            button: "Sign in as Department",
            asideHeading: "Every assigned issue deserves action.",
            asideDescription:
                "Review complaints assigned to your department and keep citizens informed about their progress.",
            illustrationTitle: "Complaint assigned",
            illustrationDescription: "Ready for department review",
            steps: ["REVIEW", "ACTION", "UPDATE"]
        },

        admin: {
            badge: "ADMINISTRATOR PORTAL",
            heading: "Administrator Sign In",
            description:
                "Access the administrative portal to manage assignments, review escalations, and oversee complaints.",
            button: "Sign in as Administrator",
            asideHeading: "Keep every civic report accountable.",
            asideDescription:
                "Oversee complaint assignments, review unclassified issues, and manage department decisions.",
            illustrationTitle: "Admin review",
            illustrationDescription: "Centralised complaint oversight",
            steps: ["REVIEW", "ASSIGN", "OVERSEE"]
        }
    };

    if (authYear) {
        authYear.textContent = new Date().getFullYear();
    }

    function showMessage(message, type = "info") {
        if (!formMessage) return;

        formMessage.textContent = message;
        formMessage.classList.remove(
            "is-visible",
            "is-info",
            "is-success",
            "is-error"
        );

        formMessage.classList.add(
            type === "success"
                ? "is-success"
                : type === "error"
                    ? "is-error"
                    : "is-info"
        );

        formMessage.classList.add("is-visible");
    }

    function clearMessage() {
        if (!formMessage) return;

        formMessage.textContent = "";
        formMessage.classList.remove(
            "is-visible",
            "is-info",
            "is-success",
            "is-error"
        );
    }

    function getSelectedRole() {
        return document.querySelector(
            'input[name="role"]:checked'
        )?.value || "user";
    }

    function updatePortal(portal) {
        const content = portalContent[portal];
        if (!content) return;

        if (roleBadgeText) roleBadgeText.textContent = content.badge;
        if (loginHeading) loginHeading.textContent = content.heading;
        if (loginDescription) loginDescription.textContent = content.description;
        if (submitButtonText) submitButtonText.textContent = content.button;

        if (asideHeading) asideHeading.textContent = content.asideHeading;
        if (asideDescription) asideDescription.textContent = content.asideDescription;
        if (illustrationTitle) illustrationTitle.textContent = content.illustrationTitle;
        if (illustrationDescription) {
            illustrationDescription.textContent = content.illustrationDescription;
        }

        if (stepOne) stepOne.textContent = content.steps[0];
        if (stepTwo) stepTwo.textContent = content.steps[1];
        if (stepThree) stepThree.textContent = content.steps[2];

        if (signupPrompt) {
            signupPrompt.hidden = portal !== "user";
        }

        clearMessage();
    }

    function setPortalMode(portal) {
        adminMode = portal === "admin";

        if (page) {
            page.classList.toggle("admin-mode", adminMode);
        }

        if (roleSelector) {
            roleSelector.hidden = adminMode;
        }

        if (adminAccessLink) {
            adminAccessLink.textContent = adminMode
                ? "← Citizen / Department access"
                : "Administrator access";
        }

        updatePortal(portal);
    }

    roleInputs.forEach((input) => {
        input.addEventListener("change", () => {
            if (!adminMode) {
                updatePortal(getSelectedRole());
            }
        });
    });

    if (adminAccessLink) {
        adminAccessLink.addEventListener("click", (event) => {
            event.preventDefault();

            if (adminMode) {
                setPortalMode(getSelectedRole());
            } else {
                setPortalMode("admin");
            }
        });
    }

    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener("click", (event) => {
            event.preventDefault();

            showMessage(
                "Password recovery is not available yet. Please contact the system administrator.",
                "info"
            );
        });
    }

    // Real sign-in through the Flask API.
    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            clearMessage();

            if (isLoggingIn) return;

            if (!loginForm.reportValidity()) return;

            const email = emailInput?.value.trim().toLowerCase();
            const password = passwordInput?.value;
            const selectedRole = adminMode ? "admin" : getSelectedRole();

            if (!email || !password) {
                showMessage(
                    "Please enter your email address and password.",
                    "error"
                );
                return;
            }

            isLoggingIn = true;

            if (submitButton) {
                submitButton.disabled = true;
            }

            if (submitButtonText) {
                submitButtonText.textContent = "Signing in...";
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/login`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                       email: email,
                       password: password
                    })
                });

                const result = await response.json().catch(() => ({}));

                if (!response.ok) {
                    showMessage(
                        result.message ||
                        result.error ||
                        "Invalid email or password.",
                        "error"
                    );
                    return;
                }

                const account = result.user;

                if (!account) {
                    showMessage(
                        "The server response did not include account details.",
                        "error"
                    );
                    return;
                }

                // Normalise role names used by the backend.
                const backendRole = String(account.role || "").toLowerCase();

                const roleAliases = {
                    user: "user",
                    citizen: "user",
                    department: "department",
                    admin: "admin",
                    administrator: "admin"
                };

                const actualRole = roleAliases[backendRole];

                // Never trust the selected portal alone.
                if (!actualRole || actualRole !== selectedRole) {
                    showMessage(
                        "This account does not have access to the selected portal.",
                        "error"
                    );
                    return;
                }

                // Keep basic account details for the frontend.
                // Do not store the password.
                sessionStorage.setItem(
                    "civicfixUser",
                    JSON.stringify({
                        name: account.name || account.full_name || "",
                        email: account.email || email,
                        role: actualRole,
                        department: account.department || ""
                    })
                );

                showMessage("Sign-in successful! Redirecting...", "success");

                const destinations = {
                    user: "report.html",
                    department: "department.html",
                    admin: "admin.html"
                };

                window.setTimeout(() => {
                    window.location.href = destinations[actualRole];
                }, 700);

            } catch (error) {
                console.error("CivicFix login error:", error);

                showMessage(
                    "Could not connect to Flask. Make sure the backend is running at http://127.0.0.1:5000.",
                    "error"
                );
            } finally {
                isLoggingIn = false;

                if (submitButton) {
                    submitButton.disabled = false;
                }

                if (submitButtonText) {
                    submitButtonText.textContent =
                        portalContent[adminMode ? "admin" : getSelectedRole()].button;
                }
            }
        });
    }

    // Default portal.
    setPortalMode("user");
});