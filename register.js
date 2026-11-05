/* ========================================
   CIVICFIX AI — REGISTER PAGE
======================================== */

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("registerForm");
    const fullNameInput = document.getElementById("fullName");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const message = document.getElementById("registerMessage");
    const submitButton = document.getElementById("registerButton");

    if (
        !form ||
        !fullNameInput ||
        !emailInput ||
        !passwordInput ||
        !confirmPasswordInput ||
        !message ||
        !submitButton
    ) {
        console.error(
            "CivicFix AI: Registration form elements are missing."
        );
        return;
    }

    // Display success and error messages.
    function showMessage(text, type) {
        message.textContent = text;
        message.className =
            `register-message is-visible is-${type}`;
    }

    function clearMessage() {
        message.textContent = "";
        message.className = "register-message";
    }

    function clearInvalidState(input) {
        input.removeAttribute("aria-invalid");
    }

    function markInvalid(input) {
        input.setAttribute("aria-invalid", "true");
        input.focus();
    }

    // Clear validation messages when the user edits a field.
    [
        fullNameInput,
        emailInput,
        passwordInput,
        confirmPasswordInput
    ].forEach((input) => {
        input.addEventListener("input", () => {
            clearInvalidState(input);
            clearMessage();
        });
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearMessage();

        const fullName = fullNameInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        // Validate full name.
        if (!fullName) {
            showMessage("Please enter your full name.", "error");
            markInvalid(fullNameInput);
            return;
        }

        if (fullName.length > 100) {
            showMessage(
                "Your name must be 100 characters or fewer.",
                "error"
            );
            markInvalid(fullNameInput);
            return;
        }

        // Validate email.
        if (!email || !emailInput.validity.valid) {
            showMessage(
                "Please enter a valid email address.",
                "error"
            );
            markInvalid(emailInput);
            return;
        }

        // Validate password.
        if (password.length < 8) {
            showMessage(
                "Your password must contain at least 8 characters.",
                "error"
            );
            markInvalid(passwordInput);
            return;
        }

        if (password !== confirmPassword) {
            showMessage(
                "The passwords do not match. Please try again.",
                "error"
            );
            markInvalid(confirmPasswordInput);
            return;
        }

        submitButton.disabled = true;

        const buttonText = submitButton.querySelector("span:first-child");

        if (buttonText) {
            buttonText.textContent = "Creating account...";
        }

        try {
            /*
             * Flask API:
             * POST http://127.0.0.1:5000/api/register
             *
             * Expected JSON:
             * {
             *   full_name,
             *   email,
             *   password,
             *   role: "citizen"
             * }
             */

            const response = await fetch(
                "http://127.0.0.1:5000/api/register",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name: fullName,
                        email: email,
                        password: password,
                        role: "citizen"
                    })
                }
            );

            // Read the response safely.
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                if (response.status === 409) {
                    showMessage(
                        "An account with this email already exists. Try signing in.",
                        "error"
                    );
                } else {
                    showMessage(
                        result.message ||
                        result.error ||
                        `Registration failed (HTTP ${response.status}).`,
                        "error"
                    );
                }

                console.error("Registration API response:", result);
                return;
            }

            showMessage(
                result.message ||
                "Account created successfully! You can now sign in.",
                "success"
            );

            form.reset();

            // Redirect to login after successful registration.
            window.setTimeout(() => {
                window.location.href = "login.html";
            }, 1500);

        } catch (error) {
            console.error(
                "CivicFix AI registration connection error:",
                error
            );

            showMessage(
                "Could not reach Flask. Check that the backend is running at http://127.0.0.1:5000.",
                "error"
            );
        } finally {
            submitButton.disabled = false;

            if (buttonText) {
                buttonText.textContent = "Create Account";
            }
        }
    });
});