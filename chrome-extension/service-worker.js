const DEFAULT_ENDPOINT = "http://127.0.0.1:32145";
const DAILY_ALARM = "douyin-archive-daily-sync";
const COOKIE_DEBOUNCE_ALARM = "douyin-archive-cookie-debounce";
const REFRESH_POLL_ALARM = "douyin-archive-refresh-poll";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInstallationId();
  await ensureDailyAlarm();
  await ensureRefreshPoll();
  await syncCookies();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDailyAlarm();
  await ensureRefreshPoll();
  await syncCookies();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (
    alarm.name === DAILY_ALARM ||
    alarm.name === COOKIE_DEBOUNCE_ALARM
  ) {
    await syncCookies();
  }
  if (alarm.name === REFRESH_POLL_ALARM) {
    await refreshIfNeeded();
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
    case "GET_MONITOR_STATUS":
      return getMonitorStatus(message.url);
    case "ADD_MONITOR":
      return addMonitor(message.url);
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
    return { ok: true, ...response };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
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
  try {
    const response = await apiRequest(
      `/api/v1/monitors/status?url=${encodeURIComponent(
        requireDouyinUserUrl(url),
      )}`,
    );
    return { ok: true, ...response };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function addMonitor(url) {
  const sync = await syncCookies();
  if (!sync.ok) return sync;
  try {
    const response = await apiRequest("/api/v1/monitors", {
      method: "POST",
      body: {
        url: requireDouyinUserUrl(url),
        accountKey: `install:${await ensureInstallationId()}`,
      },
    });
    return { ok: true, ...response };
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${DEFAULT_ENDPOINT}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
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
