const elements = {
  syncNow: document.querySelector("#sync-now"),
  addMonitor: document.querySelector("#add-monitor"),
  connectionLabel: document.querySelector("#connection-label"),
  statusDot: document.querySelector("#status-dot"),
  lastSync: document.querySelector("#last-sync"),
  monitorLabel: document.querySelector("#monitor-label"),
  pageUser: document.querySelector("#page-user"),
  queueCount: document.querySelector("#queue-count"),
  pendingQueue: document.querySelector("#pending-queue"),
  message: document.querySelector("#message"),
};

let pageContext = null;
let pageMonitored = false;
let pageStatusRequestId = 0;
let pendingMonitors = [];

elements.syncNow.addEventListener("click", () => void syncNow());
elements.addMonitor.addEventListener("click", () => void addMonitor());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "MONITOR_QUEUE_CHANGED") {
    applyQueueStatus(message.pendingMonitors || []);
  }
});

void initialize();

async function initialize() {
  pageContext = await getPageContext();
  renderPageContext();
  void refreshPageContextFromContent();
  void refreshPendingQueue();
  void refreshState();
}

async function getState() {
  return chrome.runtime.sendMessage({ type: "GET_STATE" });
}

async function getPageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = parseUserPage(tab?.url);
  if (!target) return null;
  return {
    pageUrl: target.url,
    pageUserName: detectTitleUserName(tab?.title),
  };
}

async function refreshPageContextFromContent() {
  if (!pageContext?.pageUrl) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_PAGE_CONTEXT",
    });
    if (
      response?.context?.pageUrl === pageContext.pageUrl &&
      response.context.pageUserName
    ) {
      pageContext = {
        ...pageContext,
        pageUserName: response.context.pageUserName,
      };
      elements.pageUser.textContent = pageContext.pageUserName;
    }
  } catch {
    // 页面 content script 尚未就绪时，URL 识别结果已经足够添加监听。
  }
}

async function refreshState() {
  setSyncBusy(true);
  const state = await getState().catch(() => null);
  renderState(state);
  setSyncBusy(false);
}

async function refreshPendingQueue() {
  const response = await chrome.runtime
    .sendMessage({ type: "GET_PENDING_MONITORS" })
    .catch(() => null);
  if (response?.ok && Array.isArray(response.pendingMonitors)) {
    applyQueueStatus(response.pendingMonitors);
  } else {
    renderPendingQueue();
  }
}

function renderState(state) {
  const connected = Boolean(state?.connected);
  elements.statusDot.classList.toggle("connected", connected);
  elements.connectionLabel.classList.toggle("connected", connected);
  elements.connectionLabel.textContent = connected
    ? `已连接 · ${state.defaultIntervalMinutes} 分钟`
    : "软件未运行";
  elements.lastSync.textContent = formatTime(state?.lastSyncAt);
  elements.syncNow.disabled = false;
}

function renderPageContext() {
  elements.monitorLabel.classList.remove("connected");
  elements.monitorLabel.classList.add("neutral");
  if (!pageContext?.pageUrl) {
    pageMonitored = false;
    elements.pageUser.textContent = "请打开抖音用户主页";
    elements.monitorLabel.textContent = "非用户主页";
    elements.addMonitor.disabled = true;
    elements.addMonitor.textContent = "添加监听";
    return;
  }
  elements.pageUser.textContent =
    pageContext.pageUserName || pageContext.pageUrl;
  pageMonitored = false;
  elements.monitorLabel.textContent = "可以添加";
  elements.addMonitor.disabled = false;
  elements.addMonitor.textContent = "添加监听";
  void refreshPageMonitorStatus(pageContext.pageUrl);
}

async function refreshPageMonitorStatus(pageUrl) {
  const requestId = ++pageStatusRequestId;
  const status = await chrome.runtime
    .sendMessage({
      type: "GET_MONITOR_STATUS",
      url: pageUrl,
    })
    .catch(() => null);
  if (requestId !== pageStatusRequestId || pageContext?.pageUrl !== pageUrl) {
    return;
  }
  if (status?.ok && status.monitored) {
    pageMonitored = true;
    elements.monitorLabel.textContent = "已监听";
    elements.monitorLabel.classList.remove("neutral");
    elements.monitorLabel.classList.add("connected");
    elements.addMonitor.disabled = true;
    elements.addMonitor.textContent = "已在监听列表";
    return;
  }
  if (status?.ok && status.pending) {
    pageMonitored = true;
    elements.monitorLabel.textContent = "已保存，待同步";
    elements.monitorLabel.classList.remove("neutral");
    elements.monitorLabel.classList.add("connected");
    elements.addMonitor.disabled = true;
    elements.addMonitor.textContent = "等待桌面软件连接";
    return;
  }
}

function applyQueueStatus(pendingMonitors) {
  setPendingMonitors(pendingMonitors);
  if (!pageContext?.pageUrl) return;
  const pending = pendingMonitors.some((item) => item?.url === pageContext.pageUrl);
  if (pending) {
    applyMonitorResult({ status: "queued" });
    return;
  }
  if (pageMonitored && elements.monitorLabel.textContent === "已保存，待同步") {
    pageMonitored = false;
    elements.monitorLabel.classList.remove("connected");
    elements.monitorLabel.classList.add("neutral");
    elements.monitorLabel.textContent = "正在确认";
    elements.addMonitor.disabled = true;
    elements.addMonitor.textContent = "正在确认";
    void refreshPageMonitorStatus(pageContext.pageUrl);
  }
}

function setPendingMonitors(items) {
  pendingMonitors = Array.isArray(items) ? items.filter((item) => item?.url) : [];
  renderPendingQueue();
}

function renderPendingQueue() {
  const sorted = sortedPendingMonitors();
  elements.queueCount.textContent = `${sorted.length} 条`;
  elements.queueCount.classList.toggle("connected", sorted.length > 0);
  elements.queueCount.classList.toggle("neutral", sorted.length === 0);
  elements.pendingQueue.replaceChildren();

  if (!sorted.length) {
    const empty = document.createElement("p");
    empty.className = "queue-empty";
    empty.textContent = "暂无未同步监听";
    elements.pendingQueue.append(empty);
    return;
  }

  for (const item of sorted) {
    elements.pendingQueue.append(createQueueItem(item));
  }
}

function sortedPendingMonitors() {
  return [...pendingMonitors].sort((left, right) => {
    const leftCurrent = pageContext?.pageUrl && left.url === pageContext.pageUrl;
    const rightCurrent = pageContext?.pageUrl && right.url === pageContext.pageUrl;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return timestamp(left.addedAt) - timestamp(right.addedAt);
  });
}

function createQueueItem(item) {
  const current = pageContext?.pageUrl === item.url;
  const wrapper = document.createElement("article");
  wrapper.className = `queue-item${current ? " current" : ""}`;

  const titleRow = document.createElement("div");
  titleRow.className = "queue-title-row";
  const title = document.createElement("strong");
  title.className = "queue-title";
  title.textContent = item.pageUserName || userIdFromUrl(item.url) || "抖音用户主页";
  titleRow.append(title);
  if (current) {
    const badge = document.createElement("span");
    badge.className = "queue-current";
    badge.textContent = "当前";
    titleRow.append(badge);
  }

  const actionRow = document.createElement("div");
  actionRow.className = "queue-actions";
  const time = document.createElement("span");
  time.className = "queue-time";
  time.textContent = formatQueueTime(item.addedAt);

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "queue-action";
  openButton.textContent = "打开";
  openButton.addEventListener("click", () => void openQueueItem(item.url));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "queue-action danger";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => void deleteQueueItem(item.url));

  const buttons = document.createElement("div");
  buttons.className = "queue-buttons";
  if (!current) {
    buttons.append(openButton);
  }
  buttons.append(deleteButton);
  actionRow.append(time, buttons);

  wrapper.append(titleRow, actionRow);
  return wrapper;
}

async function syncNow() {
  setSyncBusy(true);
  showMessage("正在读取并同步 Cookie…");
  const result = await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
  if (result?.ok) {
    showMessage("Cookie 已同步到桌面软件", "success");
    renderState(await getState());
  } else {
    showMessage(result?.error || "同步失败", "error");
  }
  setSyncBusy(false);
}

async function openQueueItem(url) {
  await chrome.tabs.create({ url });
  window.close();
}

async function deleteQueueItem(url) {
  const result = await chrome.runtime.sendMessage({
    type: "REMOVE_PENDING_MONITOR",
    url,
  });
  if (result?.ok) {
    void refreshPendingQueue();
    showMessage("已从未同步队列删除", "success");
  } else {
    showMessage(result?.error || "删除失败", "error");
  }
}

async function addMonitor() {
  if (!pageContext?.pageUrl) return;
  setAddBusy(true);
  showMessage("正在保存到本地队列…");
  const result = await chrome.runtime.sendMessage({
    type: "ADD_MONITOR",
    url: pageContext.pageUrl,
    context: pageContext,
  });
  if (result?.ok) {
    await notifyPageMonitorStatus(result);
    applyMonitorResult(result);
    void refreshPendingQueue();
    showMessage(
      result.status === "queued"
        ? "已保存，桌面软件连接后会自动加入监听"
        : result.status === "already_exists"
        ? "这个用户已经在监听列表中"
        : "监听已添加",
      "success",
    );
  } else {
    showMessage(result?.error || "添加监听失败", "error");
  }
  setAddBusy(false);
}

async function notifyPageMonitorStatus(result) {
  if (!pageContext?.pageUrl) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "MONITOR_STATUS_CHANGED",
      url: pageContext.pageUrl,
      status: result.status === "queued" ? "queued" : "monitored",
    });
  } catch {
    // 页面 content script 不可用时只更新 popup 自身。
  }
}

function applyMonitorResult(result) {
  pageMonitored = true;
  elements.monitorLabel.classList.remove("neutral");
  elements.monitorLabel.classList.add("connected");
  if (result.status === "queued") {
    elements.monitorLabel.textContent = "已保存，待同步";
    elements.addMonitor.textContent = "等待桌面软件连接";
  } else {
    elements.monitorLabel.textContent = "已监听";
    elements.addMonitor.textContent = "已在监听列表";
  }
}

function setSyncBusy(busy) {
  elements.syncNow.disabled = busy;
}

function setAddBusy(busy) {
  elements.addMonitor.disabled =
    busy || !pageContext?.pageUrl || pageMonitored;
}

function showMessage(text, tone = "") {
  elements.message.textContent = text || "";
  elements.message.className = `message ${tone}`.trim();
}

function formatTime(value) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatQueueTime(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function timestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function userIdFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const match = url.pathname.match(/^\/user\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function parseUserPage(value) {
  try {
    const url = new URL(String(value || ""));
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

function detectTitleUserName(value) {
  const title = String(value || "").trim();
  if (!title) return null;
  return title.split("-")[0]?.trim().slice(0, 120) || null;
}
