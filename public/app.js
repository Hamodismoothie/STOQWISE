// Progressive enhancement only. Every page works without JavaScript.
(function () {
  "use strict";

  // Show the selected file name and highlight the drop zone.
  var input = document.getElementById("file");
  var zone = document.getElementById("dropzone");
  var label = document.getElementById("file-name");

  if (input && label) {
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) {
        label.textContent = "";
        return;
      }
      var mb = (file.size / (1024 * 1024)).toFixed(1);
      label.textContent = file.name + " · " + mb + " MB";
    });
  }

  if (zone) {
    ["dragenter", "dragover"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.remove("dragover");
      });
    });
    zone.addEventListener("drop", function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length || !input) return;
      var dt = new DataTransfer();
      dt.items.add(files[0]);
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
    });
  }

  // Confirm destructive actions without inline handlers (CSP friendly).
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      var message = form.getAttribute("data-confirm");
      if (message && !window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  // Prevent double submits.
  document.querySelectorAll("form").forEach(function (form) {
    form.addEventListener("submit", function () {
      var button = form.querySelector('button[type="submit"]');
      if (button && !form.hasAttribute("data-confirm")) {
        setTimeout(function () {
          button.disabled = true;
          button.textContent = "Arbetar…";
        }, 10);
      }
    });
  });
})();
