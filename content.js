const DIVISOR = 5;

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "CODE",
  "PRE",
]);

const DOLLAR_AMOUNT = /-?\$\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const BARE_NUMBER = /^\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*$/;

const scaledFrom = new WeakMap();
let applyDepth = 0;

function isTargetPage() {
  return (
    location.hostname === "app.dataannotation.tech" &&
    /^\/workers\/(?:payments|projects)(?:\/|$)/.test(location.pathname)
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

function nearestPreviousText(node) {
  let current = node;
  for (let depth = 0; depth < 6 && current; depth++) {
    let prev = current.previousSibling;
    while (prev) {
      const text = textOf(prev).replace(/\s+/g, " ").trim();
      if (text) return text;
      prev = prev.previousSibling;
    }

    const parent = current.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;
    current = parent;
  }
  return "";
}

function numberStartsWithDollar(node) {
  return /\$$/.test(nearestPreviousText(node));
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

  if (current.includes("$")) {
    DOLLAR_AMOUNT.lastIndex = 0;
    next = current.replace(DOLLAR_AMOUNT, (match) => {
      const scaled = scaleMatch(match);
      if (scaled !== match) changed = true;
      return scaled;
    });
  } else if (BARE_NUMBER.test(current) && numberStartsWithDollar(node)) {
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
  if (!root || !isTargetPage()) return;

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
  if (!isTargetPage() || !document.body) return;
  processRoot(document.body);
}

const observer = new MutationObserver((mutations) => {
  if (applyDepth > 0 || !isTargetPage()) return;
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
