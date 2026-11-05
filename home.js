
/* =========================================
   CIVICFIX AI — HOMEPAGE INTERACTIONS
========================================= */

document.addEventListener("DOMContentLoaded", () => {
    const menuToggle = document.getElementById("menuToggle");
    const navLinks = document.getElementById("navLinks");
    const currentYear = document.getElementById("currentYear");

    // Update the footer year.
    if (currentYear) {
        currentYear.textContent = new Date().getFullYear();
    }

    // Mobile navigation menu.
    if (menuToggle && navLinks) {
        const closeMenu = () => {
            navLinks.classList.remove("is-open");
            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.setAttribute("aria-label", "Open navigation");
        };

        menuToggle.addEventListener("click", () => {
            const isOpen = navLinks.classList.toggle("is-open");

            menuToggle.setAttribute("aria-expanded", String(isOpen));
            menuToggle.setAttribute(
                "aria-label",
                isOpen ? "Close navigation" : "Open navigation"
            );
        });

        // Close the menu after selecting a link.
        navLinks.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", closeMenu);
        });

        // Close the menu when the Escape key is pressed.
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeMenu();
                menuToggle.focus();
            }
        });

        // Keep navigation closed when returning to desktop width.
        window.addEventListener("resize", () => {
            if (window.innerWidth > 820) {
                closeMenu();
            }
        });
    }
});
