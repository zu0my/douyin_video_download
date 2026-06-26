const elements = {
  syncNow: document.querySelector("#sync-now"),
  addMonitor: document.querySelector("#add-monitor"),
  connectionLabel: document.querySelector("#connection-label"),
  statusDot: document.querySelector("#status-dot"),
  lastSync: document.querySelector("#last-sync"),
  monitorLabel: document.querySelector("#monitor-label"),
  pageUser: document.querySelector("#page-user"),
  message: document.querySelector("#message"),
};

let pageContext = null;
let pageMonitored = false;

elements.syncNow.addEventListener("click", () => void syncNow());
elements.addMonitor.addEventListener("click", () => void addMonitor());

void initialize();

async function initialize() {
  setBusy(true);
  const [state, context] = await Promise.all([getState(), getPageContext()]);
  renderState(state);
  pageContext = context;
  await renderPageContext();
  setBusy(false);
}

async function getState() {
  return chrome.runtime.sendMessage({ type: "GET_STATE" });
}

async function getPageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("douyin.com")) return null;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_PAGE_CONTEXT",
    });
    return response?.context || null;
  } catch {
    return null;
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

async function renderPageContext() {
  if (!pageContext?.pageUrl) {
    pageMonitored = false;
    elements.pageUser.textContent = "请打开抖音用户主页";
    elements.monitorLabel.textContent = "非用户主页";
    elements.addMonitor.disabled = true;
    return;
  }
  elements.pageUser.textContent =
    pageContext.pageUserName || pageContext.pageUrl;
  const status = await chrome.runtime.sendMessage({
    type: "GET_MONITOR_STATUS",
    url: pageContext.pageUrl,
  });
  if (status?.ok && status.monitored) {
    pageMonitored = true;
    elements.monitorLabel.textContent = "已监听";
    elements.monitorLabel.classList.add("connected");
    elements.addMonitor.disabled = true;
    elements.addMonitor.textContent = "已在监听列表";
    return;
  }
  pageMonitored = false;
  elements.monitorLabel.textContent = status?.ok ? "可以添加" : "等待连接";
  elements.addMonitor.disabled = false;
}

async function syncNow() {
  setBusy(true);
  showMessage("正在读取并同步 Cookie…");
  const result = await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
  if (result?.ok) {
    showMessage("Cookie 已同步到桌面软件", "success");
    renderState(await getState());
  } else {
    showMessage(result?.error || "同步失败", "error");
  }
  setBusy(false);
}

async function addMonitor() {
  if (!pageContext?.pageUrl) return;
  setBusy(true);
  showMessage("正在同步 Cookie 并添加监听…");
  const result = await chrome.runtime.sendMessage({
    type: "ADD_MONITOR",
    url: pageContext.pageUrl,
    context: pageContext,
  });
  if (result?.ok) {
    showMessage(
      result.status === "already_exists"
        ? "这个用户已经在监听列表中"
        : "监听已添加",
      "success",
    );
    await renderPageContext();
  } else {
    showMessage(result?.error || "添加监听失败", "error");
  }
  setBusy(false);
}

function setBusy(busy) {
  elements.syncNow.disabled = busy;
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
