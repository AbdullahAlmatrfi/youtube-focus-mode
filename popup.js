const form = document.getElementById("feedback-form");
const userEmail = document.getElementById("user-email");
const message = document.getElementById("message");
const statusEl = document.getElementById("status");
const copyBtn = document.getElementById("copy-btn");

const supportEmail = document.body.dataset.supportEmail || "";
const subject = document.body.dataset.subject || "Feedback";

function buildBody(email, feedback) {
    const lines = [];
    if (email) lines.push(`From: ${email}`);
    lines.push("");
    lines.push("Feedback:");
    lines.push(feedback);
    return lines.join("\n");
}

function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", isError);
}

form.addEventListener("submit", (e) => {
    e.preventDefault();
    const feedback = message.value.trim();
    if (!feedback) {
        setStatus("Please add your feedback before sending.", true);
        return;
    }

    const body = buildBody(userEmail.value.trim(), feedback);
    const mailto = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto);
    setStatus("Email draft opened.");
});

copyBtn.addEventListener("click", async () => {
    const feedback = message.value.trim();
    if (!feedback) {
        setStatus("Please add your feedback before copying.", true);
        return;
    }

    const body = buildBody(userEmail.value.trim(), feedback);
    try {
        await navigator.clipboard.writeText(`To: ${supportEmail}\nSubject: ${subject}\n\n${body}`);
        setStatus("Copied to clipboard.");
    } catch (err) {
        setStatus("Copy failed. Please try again.", true);
    }
});
