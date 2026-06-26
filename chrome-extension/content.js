const HOST_ID = "douyin-archive-companion";
let currentUrl = "";
let pageContext = null;
let renderTimer = null;
let statusRequestId = 0;

const observer = new MutationObserver(() => scheduleRender());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", scheduleRender);
window.addEventListener("hashchange", scheduleRender);
window.setInterval(() => {
  if (location.href !== currentUrl) scheduleRender();
}, 1000);

scheduleRender();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_CONTEXT") {
    sendResponse({ ok: true, context: pageContext });
  }
  if (message?.type === "MONITOR_STATUS_CHANGED") {
    applyExternalMonitorStatus(message);
    sendResponse({ ok: true });
  }
  if (message?.type === "MONITOR_QUEUE_CHANGED") {
    applyQueueStatus(message.pendingMonitors || []);
    sendResponse({ ok: true });
  }
});

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 180);
}

async function render() {
  currentUrl = location.href;
  const target = parseUserPage(location.href);
  const existing = document.getElementById(HOST_ID);
  if (!target) {
    existing?.remove();
    pageContext = null;
    return;
  }

  pageContext = {
    pageUrl: target.url,
    pageUserName: detectPageUserName(),
  };

  const host = existing || createButtonHost();
  const button = host.shadowRoot.querySelector("button");
  if (button.dataset.pageUrl !== target.url) {
    button.dataset.pageUrl = target.url;
    setButtonState(button, "添加监听", false);
  }
  const checkedUrl = target.url;
  const requestId = ++statusRequestId;
  const status = await chrome.runtime.sendMessage({
    type: "GET_MONITOR_STATUS",
    url: checkedUrl,
  });
  if (
    requestId !== statusRequestId ||
    pageContext?.pageUrl !== checkedUrl ||
    button.dataset.pageUrl !== checkedUrl
  ) {
    return;
  }
  if (status?.ok && status.monitored) {
    setButtonState(button, "已监听", true, "success");
  } else if (status?.ok && status.pending) {
    setButtonState(button, "已保存，待同步", true, "success");
  } else if (status?.ok && button.dataset.state !== "adding") {
    setButtonState(button, "添加监听", false);
  }
}

function createButtonHost() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    button {
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 9px;
      background: #226864;
      color: #fffdf8;
      min-height: 38px;
      padding: 0 16px;
      font: 600 14px/1 "Microsoft YaHei", "Segoe UI", sans-serif;
      letter-spacing: .02em;
      box-shadow: 0 8px 26px rgba(0,0,0,.24);
      cursor: pointer;
      transition: transform .16s ease, background .16s ease, opacity .16s ease;
    }
    button:hover:not(:disabled) { background: #194f4c; transform: translateY(-1px); }
    button:active:not(:disabled) { transform: translateY(0); }
    button:disabled { cursor: default; opacity: .78; }
    button[data-tone="success"] { background: #3d514d; }
    button[data-tone="warning"] { background: #8a542b; }
    :host {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483646;
      margin: 0;
    }
  `;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "添加监听";
  button.addEventListener("click", () => void addCurrentMonitor(button));
  shadow.append(style, button);
  return host;
}

async function addCurrentMonitor(button) {
  if (!pageContext?.pageUrl) return;
  setButtonState(button, "正在添加", true);
  const result = await chrome.runtime.sendMessage({
    type: "ADD_MONITOR",
    url: pageContext.pageUrl,
    context: pageContext,
  });
  if (result?.ok) {
    setButtonState(
      button,
      result.status === "queued"
        ? "已保存，待同步"
        : result.status === "already_exists"
          ? "已监听"
          : "添加成功",
      true,
      "success",
    );
    return;
  }
  setButtonState(button, "添加失败，点击重试", false, "warning");
  button.title = result?.error || "添加监听失败";
}

function applyExternalMonitorStatus(message) {
  if (!message?.url || pageContext?.pageUrl !== message.url) return;
  const target = parseUserPage(location.href);
  if (!target || target.url !== message.url) return;

  statusRequestId += 1;
  const host = document.getElementById(HOST_ID) || createButtonHost();
  const button = host.shadowRoot.querySelector("button");
  button.dataset.pageUrl = target.url;

  if (message.status === "queued") {
    setButtonState(button, "已保存，待同步", true, "success");
    return;
  }
  if (message.status === "monitored") {
    setButtonState(button, "已监听", true, "success");
  }
}

function applyQueueStatus(pendingMonitors) {
  if (!pageContext?.pageUrl) return;
  const target = parseUserPage(location.href);
  if (!target || target.url !== pageContext.pageUrl) return;

  const host = document.getElementById(HOST_ID) || createButtonHost();
  const button = host.shadowRoot.querySelector("button");
  const pending = pendingMonitors.some((item) => item?.url === pageContext.pageUrl);
  if (pending) {
    statusRequestId += 1;
    button.dataset.pageUrl = pageContext.pageUrl;
    setButtonState(button, "已保存，待同步", true, "success");
    return;
  }
  if (button.dataset.state === "pending") {
    scheduleRender();
  }
}

function setButtonState(button, text, disabled, tone = "") {
  button.textContent = text;
  button.disabled = disabled;
  button.dataset.tone = tone;
  button.dataset.state =
    text === "正在添加"
      ? "adding"
      : text === "已监听"
        ? "monitored"
        : text === "已保存，待同步"
          ? "pending"
          : "ready";
  button.title = "";
}

function parseUserPage(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/user\/([^/?#]+)/);
    if (!match) return null;
    return {
      secUserId: decodeURIComponent(match[1]),
      url: url.href,
    };
  } catch {
    return null;
  }
}

function detectPageUserName() {
  const candidates = [
    '[data-e2e="user-title"]',
    '[data-e2e="user-name"]',
    "main h1",
    "main h2",
  ];
  for (const selector of candidates) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text && text.length <= 120) return text;
  }
  return document.title.split("-")[0]?.trim().slice(0, 120) || null;
}
