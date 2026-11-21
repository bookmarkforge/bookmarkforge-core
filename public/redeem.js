/* public/redeem.js — AppSumo deal-code redemption form.
 * Posts to the same-origin license function; external file because the
 * site CSP is script-src 'self' (no inline scripts). */
(function () {
  "use strict";

  var form = document.getElementById("redeem-form");
  var btn = document.getElementById("redeem-btn");
  var err = document.getElementById("redeem-error");
  var success = document.getElementById("redeem-success");
  var keyBox = document.getElementById("license-key");

  var MESSAGES = {
    INVALID_FORMAT: "That code doesn't look right — check for typos and try again.",
    INVALID_CODE: "This code isn't recognized. Double-check it against your AppSumo order.",
    ALREADY_REDEEMED: "This code has already been redeemed. If this was you, check your email for the license key or contact support.",
    REDEEM_IN_PROGRESS: "This code is being redeemed right now — wait a few seconds and try again.",
    STORE_UNSUPPORTED: "Redemption isn't available right now. Please try again later.",
  };

  function showError(text) {
    err.textContent = text;
    err.style.display = "block";
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    err.style.display = "none";

    var code = document.getElementById("f-code").value.trim();
    var email = document.getElementById("f-email").value.trim();
    var name = document.getElementById("f-name").value.trim();
    if (!code) {
      showError("Please enter your AppSumo code.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Redeeming…";

    fetch("/api/license/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code: code, email: email, name: name }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (out) {
        if (out.status === 200 && out.body && out.body.ok && out.body.license_key) {
          keyBox.textContent = out.body.license_key;
          form.style.display = "none";
          success.style.display = "block";
          return;
        }
        var code = out.body && out.body.error && out.body.error.code;
        showError(MESSAGES[code] || "Something went wrong. Please try again or contact support.");
      })
      .catch(function () {
        showError("Network error — check your connection and try again.");
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Redeem now";
      });
  });
})();
