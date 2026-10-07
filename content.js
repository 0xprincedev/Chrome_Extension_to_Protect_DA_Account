const DIVISOR = 5;

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "CODE",
  "PRE",
]);

const INLINE_MONEY =
  /(?<![A-Za-z])(?:USD|US\$|\$)\s*\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?|\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?\s*USD\b/gi;

const BARE_NUMBER = /^\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*$/;

const MONEY_LABEL =
  /\b(balances?|amounts?|earnings?|payouts?|paid|usd|money|fees?|bonuses?|bonus|totals?|wages?|income|compensation|gross)\b/i;

const NOT_MONEY_LABEL =
  /\b(id|count|qty|quantity|status|date|time|email|name|task|project|hour|day)\b/i;

const scaledFrom = new WeakMap();
let applyDepth = 0;

function isPaymentsPage() {
  return (
    location.hostname === "app.dataannotation.tech" &&
    /^\/workers\/payments(?:\/|$)/.test(location.pathname)
  );
}

function formatNumber(numStr) {
  const negative = numStr.startsWith("-");
  const unsigned = negative ? numStr.slice(1) : numStr;
  const hadCommas = unsigned.includes(",");
  const value = Number(unsigned.replace(/,/g, "")) / DIVISOR;
  if (!Number.isFinite(value)) return numStr;

  const dot = unsigned.indexOf(".");
  const originalPlaces = dot === -1 ? 0 : unsigned.length - dot - 1;
  const places = Math.max(originalPlaces, 2);
  let body = Math.abs(value).toFixed(places);

  if (hadCommas) {
    const [intPart, frac] = body.split(".");
    body = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (frac !== undefined) body += `.${frac}`;
  }

  return (negative ? "-" : "") + body;
}

function scaleMatch(match) {
  const numMatch = match.match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  if (!numMatch) return match;
  return match.replace(numMatch[0], formatNumber(numMatch[0]));
}

function textOf(node) {
  if (!node) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
  if (node.nodeType === Node.ELEMENT_NODE) return node.textContent || "";
  return "";
}

function classId(el) {
  if (!el) return "";
  const className = typeof el.className === "string" ? el.className : "";
  return `${className} ${el.id || ""}`;
}

function headerText(cell) {
  const headers = cell.getAttribute("headers");
  if (headers) {
    return headers
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
  }

  if (typeof cell.cellIndex === "number" && cell.cellIndex >= 0) {
    const table = cell.closest("table");
    const th = table?.querySelector(
      `thead th:nth-child(${cell.cellIndex + 1})`
    );
    if (th) return th.textContent || "";
  }

  const row = cell.parentElement;
  const grid = cell.closest("table, [role='grid'], [role='table']");
  if (!row || !grid) return "";

  const idx = [...row.children].indexOf(cell);
  const headerRow = grid.querySelector("thead tr, [role='row']");
  if (!headerRow || idx < 0) return "";
  return headerRow.children[idx]?.textContent || "";
}

function explicitMoneyLabel(node) {
  const el = node.parentElement;
  if (!el) return false;

  const bits = [classId(el), el.getAttribute("aria-label") || ""];
  const prev = el.previousElementSibling;
  if (prev && (prev.textContent || "").trim().length <= 80) {
    bits.push(prev.textContent || "");
  }

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const label = document.getElementById(id);
      if (label) bits.push(label.textContent || "");
    }
  }

  const cell = el.closest("td, [role='cell'], [role='gridcell']");
  if (cell) {
    bits.push(classId(cell));
    bits.push(headerText(cell));
  }

  const blob = bits.join(" ");
  if (NOT_MONEY_LABEL.test(blob)) return false;
  return MONEY_LABEL.test(blob);
}

function pseudoHasCurrency(el) {
  if (!el || typeof getComputedStyle !== "function") return false;
  try {
    for (const pseudo of ["::before", "::after"]) {
      const content = getComputedStyle(el, pseudo).content;
      if (content && /\$|USD/i.test(content)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function currencyNearby(node) {
  let current = node;
  for (let depth = 0; depth < 5; depth++) {
    const prev = current.previousSibling;
    const prevText = textOf(prev).trim();
    if (prevText) {
      if (prevText.length <= 80 && /\$|USD/i.test(prevText)) return true;
      break;
    }

    const parent = current.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) {
      break;
    }

    const own = (parent.textContent || "").trim();
    if (own.length <= 48 && /\$|USD/i.test(own)) return true;
    if (pseudoHasCurrency(parent)) return true;
    current = parent;
  }
  return false;
}

function shouldScaleBareNumber(node) {
  return currencyNearby(node) || explicitMoneyLabel(node) || pseudoHasCurrency(node.parentElement);
}

function rewriteTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const current = node.nodeValue;
  if (!current || current.length > 2000 || !/\d/.test(current)) return;

  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName)) return;
  if (parent.closest("textarea, input, select, [contenteditable='true']")) return;

  const prev = scaledFrom.get(node);
  if (prev && prev.output === current) return;

  let next = current;
  let changed = false;

  if (/\$|USD/i.test(current)) {
    INLINE_MONEY.lastIndex = 0;
    next = current.replace(INLINE_MONEY, (match) => {
      const scaled = scaleMatch(match);
      if (scaled !== match) changed = true;
      return scaled;
    });
  } else if (BARE_NUMBER.test(current) && shouldScaleBareNumber(node)) {
    next = current.replace(
      /-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/,
      (match) => {
        changed = true;
        return formatNumber(match);
      }
    );
  }

  if (!changed || next === current) return;
  scaledFrom.set(node, { output: next });
  node.nodeValue = next;
}

function processRoot(root) {
  if (!root || !isPaymentsPage()) return;

  const scope = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
  if (!scope) return;

  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
  while (walker.nextNode()) nodes.push(walker.currentNode);

  applyDepth += 1;
  try {
    for (const node of nodes) rewriteTextNode(node);
    if (scope.querySelectorAll) {
      for (const el of scope.querySelectorAll("*")) {
        if (el.shadowRoot) processRoot(el.shadowRoot);
      }
    }
  } finally {
    applyDepth -= 1;
  }
}

function scan() {
  if (!isPaymentsPage() || !document.body) return;
  processRoot(document.body);
}

const observer = new MutationObserver((mutations) => {
  if (applyDepth > 0 || !isPaymentsPage()) return;
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      rewriteTextNode(mutation.target);
      continue;
    }
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.TEXT_NODE) rewriteTextNode(node);
      else if (node.nodeType === Node.ELEMENT_NODE) processRoot(node);
    }
  }
});

function watch() {
  const root = document.documentElement;
  if (!root) return;
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  scan();
}

if (document.documentElement) watch();
else document.addEventListener("DOMContentLoaded", watch, { once: true });

document.addEventListener("DOMContentLoaded", scan, { once: true });
window.addEventListener("load", scan, { once: true });
window.addEventListener("popstate", scan);

let lastHref = location.href;
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  scan();
}, 400);

for (const delay of [300, 1000, 2500]) {
  setTimeout(scan, delay);
}
