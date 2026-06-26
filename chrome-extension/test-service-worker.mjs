import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createHarness({ refreshNeeded = false } = {}) {
  const storage = {};
  const requests = [];
  let messageListener;
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
    console,
    crypto: { randomUUID },
    Date,
    fetch: fetchMock,
    Intl,
    Response,
    URL,
  });

  async function send(message) {
    return new Promise((resolve) => {
      messageListener(message, {}, resolve);
    });
  }

  return {
    requests,
    send,
    storage,
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
