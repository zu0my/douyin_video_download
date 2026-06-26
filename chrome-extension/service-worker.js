const DEFAULT_ENDPOINT = "http://127.0.0.1:32145";
const DAILY_ALARM = "douyin-archive-daily-sync";
const COOKIE_DEBOUNCE_ALARM = "douyin-archive-cookie-debounce";
const REFRESH_POLL_ALARM = "douyin-archive-refresh-poll";
const PENDING_MONITORS_KEY = "pendingMonitors";
const API_REQUEST_TIMEOUT_MS = 2500;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInstallationId();
  await ensureDailyAlarm();
  await ensureRefreshPoll();
  await syncCookies();
  await flushPendingMonitors();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDailyAlarm();
  await ensureRefreshPoll();
  await syncCookies();
  await flushPendingMonitors();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (
    alarm.name === DAILY_ALARM ||
    alarm.name === COOKIE_DEBOUNCE_ALARM
  ) {
    const sync = await syncCookies();
    if (sync.ok) {
      await flushPendingMonitors();
    }
  }
  if (alarm.name === REFRESH_POLL_ALARM) {
    await refreshIfNeeded();
    await flushPendingMonitors();
  }
});

chrome.cookies.onChanged.addListener(async ({ cookie }) => {
  if (!isDouyinDomain(cookie.domain)) return;
  await chrome.alarms.create(COOKIE_DEBOUNCE_ALARM, {
    delayInMinutes: 0.5,
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return getState();
    case "SYNC_NOW":
      return syncCookies();
    case "GET_PENDING_MONITORS":
      return { ok: true, pendingMonitors: await getPendingMonitors() };
    case "GET_MONITOR_STATUS":
      return getMonitorStatus(message.url);
    case "ADD_MONITOR":
      return addMonitor(message.url, message.context);
    case "REMOVE_PENDING_MONITOR":
      return removePendingMonitorMessage(message.url);
    default:
      return { ok: false, error: "不支持的插件消息" };
  }
}

async function ensureDailyAlarm() {
  const existing = await chrome.alarms.get(DAILY_ALARM);
  if (!existing) {
    await chrome.alarms.create(DAILY_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 24 * 60,
    });
  }
}

async function ensureRefreshPoll() {
  const existing = await chrome.alarms.get(REFRESH_POLL_ALARM);
  if (!existing) {
    await chrome.alarms.create(REFRESH_POLL_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 1,
    });
  }
}

async function ensureInstallationId() {
  const { installationId } = await chrome.storage.local.get("installationId");
  if (installationId) return installationId;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ installationId: created });
  return created;
}

async function getState() {
  const { lastSyncAt } = await chrome.storage.local.get("lastSyncAt");
  try {
    const status = await apiRequest("/api/v1/status");
    return {
      ok: true,
      connected: true,
      endpoint: DEFAULT_ENDPOINT,
      lastSyncAt: lastSyncAt || null,
      defaultIntervalMinutes: status.defaultIntervalMinutes,
    };
  } catch {
    return {
      ok: true,
      connected: false,
      endpoint: DEFAULT_ENDPOINT,
      lastSyncAt: lastSyncAt || null,
      defaultIntervalMinutes: null,
    };
  }
}

async function syncCookies() {
  try {
    return { ok: true, ...(await collectAndSyncCookies()) };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function collectAndSyncCookies() {
  const cookies = await chrome.cookies.getAll({ domain: "douyin.com" });
  const cookieHeader = buildCookieHeader(cookies);
  if (!cookieHeader) {
    throw new Error("Chrome 中没有可同步的抖音 Cookie");
  }
  const collectedAt = new Date().toISOString();
  const response = await apiRequest("/api/v1/cookies/sync", {
    method: "POST",
    body: {
      accountKey: `install:${await ensureInstallationId()}`,
      cookieHeader,
      collectedAt,
    },
  });
  await chrome.storage.local.set({
    lastSyncAt: response.syncedAt || collectedAt,
  });
  return response;
}

async function refreshIfNeeded() {
  try {
    const response = await apiRequest(
      `/api/v1/cookies/refresh-needed?accountKey=${encodeURIComponent(
        `install:${await ensureInstallationId()}`,
      )}`,
    );
    if (response.refreshNeeded) {
      await syncCookies();
    }
  } catch {
    // 桌面软件未运行或本地接口暂不可用时保持静默。
  }
}

async function getMonitorStatus(url) {
  const monitorUrl = requireDouyinUserUrl(url);
  const pending = await findPendingMonitor(monitorUrl);
  if (pending) {
    return { ok: true, monitored: false, pending: true };
  }
  try {
    const response = await apiRequest(
      `/api/v1/monitors/status?url=${encodeURIComponent(
        monitorUrl,
      )}`,
    );
    if (response.monitored) {
      await removePendingMonitor(monitorUrl);
    }
    return { ok: true, ...response, pending: pending && !response.monitored };
  } catch (error) {
    if (pending && isConnectionError(error)) {
      return { ok: true, monitored: false, pending: true };
    }
    return { ok: false, error: normalizeError(error) };
  }
}

async function addMonitor(url, context = null) {
  const monitorUrl = requireDouyinUserUrl(url);
  await addPendingMonitor(monitorUrl, context);
  await chrome.alarms.create(COOKIE_DEBOUNCE_ALARM, {
    delayInMinutes: 0.1,
  });
  void flushPendingMonitors();
  return { ok: true, status: "queued", queued: true };
}

async function removePendingMonitorMessage(url) {
  await removePendingMonitor(url);
  return { ok: true };
}

async function flushPendingMonitors() {
  const pending = await getPendingMonitors();
  if (!pending.length) {
    return { ok: true, flushed: 0, remaining: 0 };
  }
  try {
    await apiRequest("/api/v1/status");
    await collectAndSyncCookies();
  } catch (error) {
    return {
      ok: false,
      error: normalizeError(error),
      remaining: pending.length,
    };
  }

  const remaining = [];
  let flushed = 0;
  const accountKey = `install:${await ensureInstallationId()}`;
  for (const item of pending) {
    try {
      await apiRequest("/api/v1/monitors", {
        method: "POST",
        body: {
          url: item.url,
          accountKey,
        },
      });
      flushed += 1;
    } catch {
      remaining.push(item);
    }
  }
  await setPendingMonitors(remaining);
  return { ok: true, flushed, remaining: remaining.length };
}

async function getPendingMonitors() {
  const stored = await chrome.storage.local.get(PENDING_MONITORS_KEY);
  const items = stored[PENDING_MONITORS_KEY];
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item?.url);
}

async function setPendingMonitors(items) {
  await chrome.storage.local.set({ [PENDING_MONITORS_KEY]: items });
  await broadcastQueueChanged(items);
}

async function findPendingMonitor(url) {
  const normalized = requireDouyinUserUrl(url);
  const pending = await getPendingMonitors();
  return pending.some((item) => item.url === normalized);
}

async function addPendingMonitor(url, context = null) {
  const normalized = requireDouyinUserUrl(url);
  const pending = await getPendingMonitors();
  if (pending.some((item) => item.url === normalized)) {
    await broadcastQueueChanged(pending);
    return;
  }
  pending.push({
    url: normalized,
    pageUserName: context?.pageUserName || null,
    addedAt: new Date().toISOString(),
  });
  await setPendingMonitors(pending);
}

async function removePendingMonitor(url) {
  const normalized = requireDouyinUserUrl(url);
  const pending = await getPendingMonitors();
  const next = pending.filter((item) => item.url !== normalized);
  if (next.length !== pending.length) {
    await setPendingMonitors(next);
  }
}

async function broadcastQueueChanged(items = null) {
  const pendingMonitors = items || (await getPendingMonitors());
  const message = {
    type: "MONITOR_QUEUE_CHANGED",
    pendingMonitors,
  };
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // 没有打开的 popup 时保持静默。
  }
  try {
    const tabs = await chrome.tabs.query({ url: ["https://*.douyin.com/*"] });
    await Promise.allSettled(
      tabs
        .filter((tab) => tab.id)
        .map((tab) => chrome.tabs.sendMessage(tab.id, message)),
    );
  } catch {
    // 页面 content script 不可用时，下一次状态查询仍会读取同一个全局队列。
  }
}

async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    API_REQUEST_TIMEOUT_MS,
  );
  let response;
  try {
    response = await fetch(`${DEFAULT_ENDPOINT}${path}`, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `桌面软件返回 ${response.status}`);
  }
  return payload;
}

function buildCookieHeader(cookies) {
  return cookies
    .filter((cookie) => cookie.name && !cookie.removed)
    .sort((left, right) => {
      const pathDifference = right.path.length - left.path.length;
      return pathDifference || left.name.localeCompare(right.name);
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function requireDouyinUserUrl(value) {
  const url = new URL(String(value || ""));
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "douyin.com" && !url.hostname.endsWith(".douyin.com")) ||
    !/^\/user\/[^/?#]+/.test(url.pathname)
  ) {
    throw new Error("当前页面不是抖音用户主页");
  }
  return url.href;
}

function isDouyinDomain(domain) {
  const normalized = String(domain || "").replace(/^\./, "").toLowerCase();
  return normalized === "douyin.com" || normalized.endsWith(".douyin.com");
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "未知错误");
}

function isConnectionError(error) {
  if (error instanceof TypeError) return true;
  const message = normalizeError(error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("abort") ||
    message.includes("timed out")
  );
}
