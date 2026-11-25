/**
 * Pre-upload check for the import form.
 *
 * Reads the first line of a CSV the user has selected, before anything is sent,
 * and reports whether the two required columns (stock and cost) appear to be
 * there. The rules come from the server (`#import-check-rules`, built from the
 * same aliases the real mapping uses), so this file never guesses at column
 * names and the browser cannot promise more than the importer delivers.
 *
 * The check is advisory: it never blocks submission, and Excel files are
 * checked after upload because a header row cannot be read without a parser.
 */
(() => {
  "use strict";

  const root = document.querySelector("[data-import-check]");
  if (!root) return;
  const rulesNode = document.getElementById("import-check-rules");
  const input = root.querySelector('input[type="file"]');
  const slot = root.querySelector("[data-import-check-slot]");
  if (!rulesNode || !input || !slot) return;

  let rules = null;
  try {
    rules = JSON.parse(rulesNode.textContent || "null");
  } catch {
    rules = null;
  }
  if (!rules || !rules.required || !rules.text) return;

  const normalize = (value) =>
    String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const normalizedAliases = (aliases) => aliases.map(normalize).filter(Boolean);

  const match = (headers, aliases) => {
    const list = normalizedAliases(aliases);
    let best = null;
    headers.forEach((header) => {
      const value = normalize(header);
      if (!value) return;
      for (const alias of list) {
        const score = value === alias ? 1 : value.includes(alias) ? 0.7 : alias.length > 4 && alias.includes(value) ? 0.6 : 0;
        if (score && (!best || score > best.score)) best = { header, score };
      }
    });
    return best && best.score >= 0.6 ? best.header : null;
  };

  const splitHeader = (line) => {
    const candidates = [";", ",", "\t", "|"].map((delimiter) => ({
      delimiter,
      count: line.split(delimiter).length - 1,
    }));
    candidates.sort((a, b) => b.count - a.count);
    const best = candidates[0];
    return best.count > 0 ? line.split(best.delimiter) : [line];
  };

  const show = (tone, lines) => {
    slot.textContent = "";
    slot.hidden = false;
    const box = document.createElement("div");
    box.className = "alert alert-" + tone;
    box.setAttribute("role", "status");
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = rules.text.title;
    body.appendChild(title);
    for (const line of lines) {
      const paragraph = document.createElement("p");
      paragraph.style.margin = "4px 0 0";
      paragraph.textContent = line;
      body.appendChild(paragraph);
    }
    box.appendChild(body);
    slot.appendChild(box);
  };

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) {
      slot.textContent = "";
      slot.hidden = true;
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      show("info", [rules.text.excel]);
      return;
    }
    show("info", [rules.text.checking]);

    let text = "";
    try {
      text = await file.text();
    } catch {
      slot.textContent = "";
      slot.hidden = true;
      return;
    }

    const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "") || "";
    if (!firstLine) {
      show("warn", [rules.text.empty]);
      return;
    }

    const headers = splitHeader(firstLine).map((header) => header.replace(/^"|"$/g, "").trim());
    const found = [];
    const missing = [];
    for (const field of rules.required) {
      const header = match(headers, field.aliases);
      if (header) found.push(field.label + ": " + header);
      else missing.push(field.label);
    }
    const identity = rules.identity ? match(headers, rules.identity.aliases) : null;

    if (missing.length) {
      show("warn", [rules.text.missing.replace("{missing}", missing.join(", ")), rules.text.hint]);
      return;
    }
    show("ok", [
      rules.text.ok.replace("{found}", found.join(" · ")),
      identity ? rules.text.identity.replace("{header}", identity) : rules.text.identityMissing,
    ]);
  });
})();
