import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createHarness({
  refreshNeeded = false,
  offline = false,
  tabs = [
    { id: 1, url: "https://www.douyin.com/user/MS4wLjABAAAA-user-a" },
    { id: 2, url: "https://www.douyin.com/user/MS4wLjABAAAA-user-b" },
    { id: 3, url: "https://example.com/" },
  ],
} = {}) {
  const storage = {};
  const requests = [];
  const extensionMessages = [];
  const tabMessages = [];
  let messageListener;
  let desktopOffline = offline;
  const listeners = {};
  const event = (name) => ({
    addListener(listener) {
      listeners[name] = listener;
    },
  });
  const chrome = {
    runtime: {
      onInstalled: event("installed"),
      onStartup: event("startup"),
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      async sendMessage(message) {
        extensionMessages.push(message);
        return { ok: true };
      },
    },
    tabs: {
      async query(query = {}) {
        if (Array.isArray(query.url)) {
          return tabs.filter((tab) => String(tab.url).includes("douyin.com"));
        }
        return tabs;
      },
      async sendMessage(tabId, message) {
        tabMessages.push({ tabId, message });
        return { ok: true };
      },
    },
    alarms: {
      onAlarm: event("alarm"),
      async get() {
        return undefined;
      },
      async create() {},
    },
    cookies: {
      onChanged: event("cookieChanged"),
      async getAll() {
        return [
          { name: "root", value: "1", path: "/" },
          { name: "account", value: "2", path: "/account" },
        ];
      },
    },
    storage: {
      local: {
        async get(keys) {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            requested
              .filter((key) => Object.hasOwn(storage, key))
              .map((key) => [key, storage[key]]),
          );
        },
        async set(value) {
          Object.assign(storage, value);
        },
      },
      session: {
        async set() {},
      },
    },
  };

  async function fetchMock(url, options = {}) {
    if (desktopOffline) {
      throw new TypeError("Failed to fetch");
    }
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/api/v1/status")) {
      return new Response(
        JSON.stringify({ ok: true, defaultIntervalMinutes: 30 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (String(url).endsWith("/api/v1/cookies/sync")) {
      return new Response(
        JSON.stringify({
          ok: true,
          cookieId: "cookie-1",
          cookieName: "Chrome · Alice",
          syncedAt: "2026-06-25T12:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (String(url).includes("/api/v1/cookies/refresh-needed")) {
      return new Response(JSON.stringify({ ok: true, refreshNeeded }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).endsWith("/api/v1/monitors")) {
      return new Response(
        JSON.stringify({
          ok: true,
          status: "created",
          monitorId: "monitor-1",
          intervalMinutes: 30,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true, monitored: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const source = fs.readFileSync(
    new URL("./service-worker.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    chrome,
    AbortController,
    clearTimeout,
    console,
    crypto: { randomUUID },
    Date,
    fetch: fetchMock,
    Intl,
    Response,
    setTimeout,
    URL,
  });

  async function send(message) {
    return new Promise((resolve) => {
      messageListener(message, {}, resolve);
    });
  }

  return {
    extensionMessages,
    requests,
    send,
    setOffline(value) {
      desktopOffline = value;
    },
    storage,
    tabMessages,
    async fireAlarm(name) {
      await listeners.alarm({ name });
    },
  };
}

test("syncs cookies under the installation fallback identity without authorization", async () => {
  const harness = createHarness();
  const synced = await harness.send({ type: "SYNC_NOW" });
  assert.equal(synced.ok, true);

  const request = harness.requests.find(({ url }) =>
    url.endsWith("/api/v1/cookies/sync"),
  );
  const body = JSON.parse(request.options.body);
  assert.equal(body.cookieHeader, "account=2; root=1");
  assert.match(body.accountKey, /^install:/);
  assert.equal(request.options.headers.Authorization, undefined);
});

test("rejects non-Douyin monitor URLs before making a request", async () => {
  const harness = createHarness();
  const before = harness.requests.length;
  const result = await harness.send({
    type: "GET_MONITOR_STATUS",
    url: "https://example.com/user/not-allowed",
  });
  assert.equal(result.ok, false);
  assert.equal(harness.requests.length, before);
});

test("refreshes cookies after the desktop app requests a retry", async () => {
  const harness = createHarness({ refreshNeeded: true });
  await harness.fireAlarm("douyin-archive-refresh-poll");
  assert.ok(
    harness.requests.some(({ url }) => url.includes("/cookies/refresh-needed")),
  );
  assert.ok(
    harness.requests.some(({ url }) => url.endsWith("/api/v1/cookies/sync")),
  );
});

test("queues monitor requests when the desktop app is unavailable", async () => {
  const harness = createHarness({ offline: true });
  const result = await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user",
    context: { pageUserName: "Alice" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "queued");
  assert.equal(harness.storage.pendingMonitors.length, 1);
  assert.equal(
    harness.storage.pendingMonitors[0].url,
    "https://www.douyin.com/user/MS4wLjABAAAA-user",
  );
  assert.equal(harness.storage.pendingMonitors[0].pageUserName, "Alice");
});

test("flushes queued monitor requests after the desktop app reconnects", async () => {
  const harness = createHarness({ offline: true });
  await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user",
  });

  harness.setOffline(false);
  await harness.fireAlarm("douyin-archive-refresh-poll");

  const monitorRequest = harness.requests.find(({ url }) =>
    url.endsWith("/api/v1/monitors"),
  );
  assert.ok(monitorRequest);
  assert.equal(
    JSON.parse(monitorRequest.options.body).url,
    "https://www.douyin.com/user/MS4wLjABAAAA-user",
  );
  assert.equal(harness.storage.pendingMonitors.length, 0);
});

test("uses one shared pending monitor queue across multiple user pages", async () => {
  const harness = createHarness({ offline: true });
  await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user-a",
  });
  await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user-b",
  });

  let queued = await harness.send({ type: "GET_PENDING_MONITORS" });
  assert.equal(queued.ok, true);
  assert.equal(queued.pendingMonitors.length, 2);

  harness.setOffline(false);
  await harness.fireAlarm("douyin-archive-refresh-poll");

  const monitorRequests = harness.requests.filter(({ url }) =>
    url.endsWith("/api/v1/monitors"),
  );
  assert.equal(monitorRequests.length, 2);
  queued = await harness.send({ type: "GET_PENDING_MONITORS" });
  assert.equal(queued.pendingMonitors.length, 0);
});

test("broadcasts the same shared pending queue to every Douyin tab", async () => {
  const harness = createHarness({ offline: true });
  await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user-a",
  });
  await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user-b",
  });

  const latestMessagesByTab = new Map();
  for (const item of harness.tabMessages) {
    latestMessagesByTab.set(item.tabId, item.message);
  }

  assert.deepEqual([...latestMessagesByTab.keys()].sort(), [1, 2]);
  for (const message of latestMessagesByTab.values()) {
    assert.equal(message.type, "MONITOR_QUEUE_CHANGED");
    assert.equal(message.pendingMonitors.length, 2);
    assert.equal(
      JSON.stringify(message.pendingMonitors.map((item) => item.url).sort()),
      JSON.stringify([
        "https://www.douyin.com/user/MS4wLjABAAAA-user-a",
        "https://www.douyin.com/user/MS4wLjABAAAA-user-b",
      ]),
    );
  }

  harness.setOffline(false);
  await harness.fireAlarm("douyin-archive-refresh-poll");

  const finalMessagesByTab = new Map();
  for (const item of harness.tabMessages) {
    finalMessagesByTab.set(item.tabId, item.message);
  }
  for (const message of finalMessagesByTab.values()) {
    assert.equal(message.type, "MONITOR_QUEUE_CHANGED");
    assert.equal(message.pendingMonitors.length, 0);
  }
});

test("removes one pending monitor from the shared queue", async () => {
  const harness = createHarness({ offline: true });
  await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user-a",
  });
  await harness.send({
    type: "ADD_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user-b",
  });

  const removed = await harness.send({
    type: "REMOVE_PENDING_MONITOR",
    url: "https://www.douyin.com/user/MS4wLjABAAAA-user-a",
  });
  assert.equal(removed.ok, true);

  const queued = await harness.send({ type: "GET_PENDING_MONITORS" });
  assert.equal(queued.pendingMonitors.length, 1);
  assert.equal(
    queued.pendingMonitors[0].url,
    "https://www.douyin.com/user/MS4wLjABAAAA-user-b",
  );

  const latestMessagesByTab = new Map();
  for (const item of harness.tabMessages) {
    latestMessagesByTab.set(item.tabId, item.message);
  }
  for (const message of latestMessagesByTab.values()) {
    assert.equal(message.type, "MONITOR_QUEUE_CHANGED");
    assert.equal(message.pendingMonitors.length, 1);
    assert.equal(
      message.pendingMonitors[0].url,
      "https://www.douyin.com/user/MS4wLjABAAAA-user-b",
    );
  }
});
