// Beta signup form handler. External file (not inline) so the page's
// Content-Security-Policy (script-src 'self' ...) permits it without
// 'unsafe-inline'. Posts JSON to /api/beta-signup, swaps the form for a
// confirmation on success, and surfaces server errors inline on failure.
(function () {
  "use strict";

  var form = document.getElementById("beta-signup-form");
  if (!form) return;

  var confirmEl = document.getElementById("beta-signup-confirm");
  var errorEl = document.getElementById("beta-signup-error");
  var submitBtn = form.querySelector('button[type="submit"]');
  var origLabel = submitBtn ? submitBtn.textContent : "";

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function setBusy(busy) {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? "Sending…" : origLabel;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }

    var payload = {
      name: (form.elements["name"] || {}).value || "",
      boat: (form.elements["boat"] || {}).value || "",
      homePort: (form.elements["homePort"] || {}).value || "",
      contact: (form.elements["contact"] || {}).value || "",
      message: (form.elements["message"] || {}).value || "",
    };

    setBusy(true);
    try {
      var res = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        form.hidden = true;
        if (confirmEl) confirmEl.hidden = false;
        return;
      }

      var msg = "Something went wrong. Please try again.";
      try {
        var data = await res.json();
        if (data && data.error) msg = data.error;
      } catch (_) {}
      showError(msg);
    } catch (err) {
      showError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  });
})();
