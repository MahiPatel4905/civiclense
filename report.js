/* CivicFix AI — Citizen Dashboard with interactive map */

(() => {
    "use strict";

    const API_BASE = "http://127.0.0.1:5000/api";
    const USER_STORAGE_KEY = "civicfixUser";
    const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

    // Gandhinagar is the initial map view, not a selected issue location.
    const DEFAULT_MAP_CENTER = [23.2156, 72.6369];
    const DEFAULT_MAP_ZOOM = 12;

    let selectedImage = null;
    let loadingReports = false;
    let submittingReport = false;
    let toastTimer = null;
    let issueMap = null;
    let issueMarker = null;
    let selectedCoordinates = null;
    let reverseGeocodeController = null;

    const $ = (id) => document.getElementById(id);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }

    // ---------------- INITIALIZATION AND AUTH ----------------

    function getUser() {
        try {
            const user = JSON.parse(
                sessionStorage.getItem(USER_STORAGE_KEY) || "null"
            );

            return user && user.email ? user : null;
        } catch {
            return null;
        }
    }

    function initialize() {
        const user = getUser();

        if (!user) {
            window.location.href = "login.html";
            return;
        }

        const role = String(user.role || "citizen").toLowerCase();

        if (role === "department") {
            window.location.href = "department.html";
            return;
        }

        if (role === "admin") {
            window.location.href = "admin.html";
            return;
        }

        const name = user.full_name || user.name || user.username || "Citizen";

        $("user-name").textContent = name;
        $("user-avatar").textContent = name.trim().charAt(0).toUpperCase() || "U";

        $("mobile-menu-toggle").addEventListener("click", toggleNavigation);

        $("main-nav").addEventListener("click", (event) => {
            if (event.target.closest("a")) closeNavigation();
        });

        $("sign-out-btn").addEventListener("click", () => {
            sessionStorage.removeItem(USER_STORAGE_KEY);
            window.location.href = "login.html";
        });

        $("issue-description").addEventListener("input", updateDescriptionCount);
        $("issue-image").addEventListener("change", handleImageSelection);
        $("remove-image-btn").addEventListener("click", removeImage);
        $("issue-form").addEventListener("submit", submitReport);
        $("live-location-btn").addEventListener("click", useLiveLocation);

        updateDescriptionCount();
        initializeMap();
        loadReports();
    }

    function toggleNavigation() {
        const open = $("main-nav").classList.toggle("open");

        $("mobile-menu-toggle").setAttribute("aria-expanded", String(open));
        $("mobile-menu-toggle").setAttribute(
            "aria-label",
            open ? "Close navigation" : "Open navigation"
        );
    }

    function closeNavigation() {
        $("main-nav").classList.remove("open");
        $("mobile-menu-toggle").setAttribute("aria-expanded", "false");
        $("mobile-menu-toggle").setAttribute("aria-label", "Open navigation");
    }

    // ---------------- MAP AND LOCATION ----------------

    function initializeMap() {
        if (!window.L || !$("issue-map")) {
            showLocationMessage(
                "The map could not load. Check your internet connection and refresh the page.",
                "error"
            );
            return;
        }

        issueMap = L.map("issue-map", {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
        }).addTo(issueMap);

        issueMap.on("click", (event) => {
            selectLocation(
                event.latlng.lat,
                event.latlng.lng,
                "Getting address for the selected point..."
            );
        });

        // Ensure tiles and controls render correctly if the page layout shifts.
        window.setTimeout(() => issueMap.invalidateSize(), 150);
    }

    function setMapMarker(latitude, longitude) {
        const coordinates = [latitude, longitude];

        if (!issueMap) return;

        if (issueMarker) {
            issueMarker.setLatLng(coordinates);
        } else {
            issueMarker = L.marker(coordinates, { draggable: true }).addTo(issueMap);

            issueMarker.on("dragend", () => {
                const point = issueMarker.getLatLng();

                selectLocation(
                    point.lat,
                    point.lng,
                    "Updating the address for your pin..."
                );
            });
        }

        issueMap.setView(coordinates, Math.max(issueMap.getZoom(), 16), {
            animate: true
        });
    }

    async function selectLocation(latitude, longitude, initialMessage) {
        selectedCoordinates = { latitude, longitude };

        setMapMarker(latitude, longitude);

        $("selected-address").value = "";
        $("selected-address").placeholder = "Getting address for the selected location...";

        showLocationMessage(initialMessage, "");

        if (reverseGeocodeController) {
            reverseGeocodeController.abort();
        }

        reverseGeocodeController = new AbortController();

        try {
            const url = new URL("https://nominatim.openstreetmap.org/reverse");
            url.searchParams.set("format", "jsonv2");
            url.searchParams.set("lat", latitude);
            url.searchParams.set("lon", longitude);
            url.searchParams.set("zoom", "18");
            url.searchParams.set("addressdetails", "1");

            const response = await fetch(url.toString(), {
                headers: { Accept: "application/json" },
                signal: reverseGeocodeController.signal
            });

            if (!response.ok) {
                throw new Error("Could not look up this address.");
            }

            const data = await response.json();
            const address = data.display_name || "";

            if (!address) {
                throw new Error("No street address was found for this point.");
            }

            // Avoid overwriting a newer selection if the user moved the pin quickly.
            if (
                selectedCoordinates &&
                selectedCoordinates.latitude === latitude &&
                selectedCoordinates.longitude === longitude
            ) {
                $("selected-address").value = address;
                $("selected-address").placeholder = "Selected address will appear here...";
                showLocationMessage("Location selected successfully.", "success");
            }
        } catch (error) {
            if (error.name === "AbortError") return;

            console.error("Reverse geocoding error:", error);

            // Preserve a usable address if reverse geocoding is unavailable.
            if (
                selectedCoordinates &&
                selectedCoordinates.latitude === latitude &&
                selectedCoordinates.longitude === longitude
            ) {
                $("selected-address").value =
                    `Pinned location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                $("selected-address").placeholder = "Selected address will appear here...";
                showLocationMessage(
                    "We couldn't retrieve the street address. The selected coordinates have been added; you can edit the address if needed.",
                    "error"
                );
            }
        }
    }

    function useLiveLocation() {
        if (!navigator.geolocation) {
            showLocationMessage(
                "Your browser does not support location services. Please select a point on the map.",
                "error"
            );
            return;
        }

        const button = $("live-location-btn");
        button.disabled = true;
        button.innerHTML = '<span aria-hidden="true">◎</span> Finding location...';
        showLocationMessage("Waiting for your browser's location permission...", "");

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    await selectLocation(
                        position.coords.latitude,
                        position.coords.longitude,
                        "Your current position was found. Getting its address..."
                    );
                } finally {
                    button.disabled = false;
                    button.innerHTML = '<span aria-hidden="true">◎</span> Use my location';
                }
            },
            (error) => {
                button.disabled = false;
                button.innerHTML = '<span aria-hidden="true">◎</span> Use my location';

                const messages = {
                    1: "Location permission was denied. Allow location access in your browser or select a point on the map.",
                    2: "Your current location could not be determined. Try again or select a point on the map.",
                    3: "Finding your location timed out. Please try again."
                };

                showLocationMessage(
                    messages[error.code] || "Unable to get your location. Please select a point on the map.",
                    "error"
                );
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 30000
            }
        );
    }

    function showLocationMessage(message, type = "") {
        const element = $("location-message");

        element.textContent = message;
        element.classList.remove("error", "success");

        if (type) element.classList.add(type);

        element.hidden = !message;
    }

    // ---------------- FORM HELPERS ----------------

    function updateDescriptionCount() {
        $("description-count").textContent =
            `${$("issue-description").value.length} / 1500`;
    }

    function showToast(message, isError = false) {
        const toast = $("toast");

        toast.textContent = message;
        toast.classList.toggle("error", isError);
        toast.classList.add("show");

        clearTimeout(toastTimer);

        toastTimer = window.setTimeout(() => {
            toast.classList.remove("show");
        }, 3500);
    }

    function showFormAlert(message, type = "error") {
        const alert = $("form-alert");

        alert.textContent = message;
        alert.classList.toggle("success", type === "success");
        alert.hidden = false;
    }

    function clearFormAlert() {
        $("form-alert").hidden = true;
        $("form-alert").textContent = "";
        $("form-alert").classList.remove("success");
    }

    // ---------------- IMAGE UPLOAD ----------------

    function handleImageSelection(event) {
        const file = event.target.files && event.target.files[0];

        if (!file) return;

        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

        if (!allowedTypes.includes(file.type)) {
            showFormAlert("Please choose a JPG, PNG or WebP image.");
            event.target.value = "";
            return;
        }

        if (file.size > MAX_IMAGE_SIZE) {
            showFormAlert("Your image must be 8 MB or smaller.");
            event.target.value = "";
            return;
        }

        selectedImage = file;

        const reader = new FileReader();

        reader.onload = () => {
            $("preview-image").src = reader.result;
            $("preview-filename").textContent = file.name;
            $("image-preview").hidden = false;
            $("upload-area").hidden = true;
            clearFormAlert();
        };

        reader.onerror = () => {
            selectedImage = null;
            event.target.value = "";
            showFormAlert("The selected image could not be read. Please try another.");
        };

        reader.readAsDataURL(file);
    }

    function removeImage() {
        selectedImage = null;
        $("issue-image").value = "";
        $("preview-image").removeAttribute("src");
        $("preview-filename").textContent = "";
        $("image-preview").hidden = true;
        $("upload-area").hidden = false;
    }

    // ---------------- REPORT STATISTICS ----------------

    function normalizeStatus(value) {
        const status = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, " ");

        if (["resolved", "completed", "closed", "fixed"].includes(status)) {
            return "resolved";
        }

        if ([
            "progress", "in progress", "inprogress", "processing",
            "assigned", "under process", "under review"
        ].includes(status)) {
            return "progress";
        }

        if (["rejected", "declined", "denied"].includes(status)) {
            return "rejected";
        }

        return "pending";
    }

    async function loadReports() {
        if (loadingReports) return;

        const user = getUser();

        if (!user) {
            window.location.href = "login.html";
            return;
        }

        loadingReports = true;

        try {
            const response = await fetch(
                `${API_BASE}/reports/${encodeURIComponent(user.email)}`,
                {
                    credentials: "include",
                    headers: { Accept: "application/json" }
                }
            );

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    result.message || result.error || "Could not load your reports."
                );
            }

            const reports = Array.isArray(result)
                ? result
                : Array.isArray(result.reports)
                    ? result.reports
                    : null;

            if (!reports) {
                throw new Error("The reports endpoint returned an unexpected response.");
            }

            updateStatistics(reports);
        } catch (error) {
            console.error("Dashboard reports error:", error);
            $("total-count").textContent = "—";
            $("progress-count").textContent = "—";
            $("resolved-count").textContent = "—";
            $("pending-count").textContent = "—";
            showToast(
                error.message || "Unable to connect to the backend.",
                true
            );
        } finally {
            loadingReports = false;
        }
    }

    function updateStatistics(reports) {
        let progress = 0;
        let resolved = 0;
        let pending = 0;

        reports.forEach((report) => {
            const status = normalizeStatus(report.status);

            if (status === "progress") {
                progress++;
            } else if (status === "resolved") {
                resolved++;
            } else {
                pending++;
            }
        });

        $("total-count").textContent = reports.length;
        $("progress-count").textContent = progress;
        $("resolved-count").textContent = resolved;
        $("pending-count").textContent = pending;
    }

    // ---------------- SUBMIT REPORT ----------------

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Could not read the selected image."));
            reader.readAsDataURL(file);
        });
    }

    async function submitReport(event) {
        event.preventDefault();

        if (submittingReport) return;

        clearFormAlert();

        const user = getUser();

        if (!user) {
            window.location.href = "login.html";
            return;
        }

        const description = $("issue-description").value.trim();
        const address = $("selected-address").value.trim();

        if (!description) {
            showFormAlert("Please describe the civic issue.");
            $("issue-description").focus();
            return;
        }

        if (!selectedImage) {
            showFormAlert("Please upload a photo of the issue.");
            return;
        }

        if (!address) {
            showFormAlert("Please select a location on the map or use your current location.");
            $("issue-location-section").scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
            return;
        }

        if (address.length > 500) {
            showFormAlert("The address must be 500 characters or fewer.");
            $("selected-address").focus();
            return;
        }

        const submitButton = $("submit-report-btn");

        submittingReport = true;
        submitButton.disabled = true;
        submitButton.textContent = "Submitting report...";

        try {
            const image = await fileToBase64(selectedImage);

            const payload = {
                email: user.email,
                description,
                image,
                location_method: selectedCoordinates ? "map" : "manual",
                address,
                latitude: selectedCoordinates?.latitude ?? null,
                longitude: selectedCoordinates?.longitude ?? null
            };

            const response = await fetch(`${API_BASE}/reports`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    result.message || result.error || "The report could not be submitted."
                );
            }

            showFormAlert("Your report was submitted successfully.", "success");
            showToast("Your civic issue has been submitted.");

            $("issue-form").reset();
            selectedImage = null;
            selectedCoordinates = null;

            if (reverseGeocodeController) {
                reverseGeocodeController.abort();
                reverseGeocodeController = null;
            }

            if (issueMarker && issueMap) {
                issueMap.removeLayer(issueMarker);
                issueMarker = null;
            }

            $("image-preview").hidden = true;
            $("upload-area").hidden = false;
            $("preview-image").removeAttribute("src");
            $("preview-filename").textContent = "";
            $("selected-address").placeholder = "Your selected location will appear here...";
            showLocationMessage("");
            updateDescriptionCount();

            await loadReports();
        } catch (error) {
            console.error("Submit report error:", error);
            showFormAlert(
                error.message || "Something went wrong while submitting your report."
            );
        } finally {
            submittingReport = false;
            submitButton.disabled = false;
            submitButton.innerHTML = 'Submit report <span aria-hidden="true">→</span>';
        }
    }
})();