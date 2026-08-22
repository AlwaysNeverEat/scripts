// ==UserScript==
// @name         SPOT Bitrix — датчик звонков
// @namespace    k-spot.ru
// @version      1.1.675
// @description  Сообщает сайту, что пришёл входящий звонок и какой лид Битрикс с ним связал. Ничего не читает и не меняет — только сообщает факт.
// @match        https://spotexpress.bitrix24.ru/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      k-spot.ru
// @connect      localhost
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20Bitrix%20Call%20Sensor-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20Bitrix%20Call%20Sensor-1.0.user.js
// ==/UserScript==

(() => {
  // shared/bitrixCall.js
  var CALL_FRESH_MS = 90 * 1e3;
  function parseCallOption(raw) {
    let data;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
    if (!data || !data.CALL_ID) return null;
    const callId = String(data.CALL_ID);
    return {
      callId,
      startedAt: callStartedAt(callId),
      phone: data.PHONE_NUMBER ? String(data.PHONE_NUMBER) : null,
      line: data.LINE_NUMBER ? String(data.LINE_NUMBER) : null,
      direction: data.CALL_DIRECTION ? String(data.CALL_DIRECTION) : "incoming",
      // Лида может не быть: звонок с неизвестного номера в первую секунду.
      // Тогда покажем хотя бы номер — это лучше, чем промолчать.
      leadId: data.CRM_ENTITY_TYPE === "LEAD" && data.CRM_ENTITY_ID ? String(data.CRM_ENTITY_ID) : null
    };
  }
  function callStartedAt(callId) {
    const m = String(callId || "").match(/(\d{10})(?:\D|$)/);
    if (!m) return null;
    const at = Number(m[1]) * 1e3;
    return Number.isFinite(at) ? at : null;
  }
  function pickCurrentCall(values, { known = /* @__PURE__ */ new Set(), now = Date.now(), maxAgeMs = CALL_FRESH_MS, firstScan: firstScan2 = false } = {}) {
    const calls = (Array.isArray(values) ? values : []).map(parseCallOption).filter(Boolean).filter((call) => !known.has(call.callId));
    const fresh = calls.filter((call) => {
      if (call.startedAt == null) return !firstScan2;
      return now - call.startedAt <= maxAgeMs && now - call.startedAt >= -maxAgeMs;
    });
    if (!fresh.length) return null;
    fresh.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return fresh[0];
  }

  // userscript/src/bitrix-call/app.js
  var API_BASE = "https://k-spot.ru";
  var API_KEY = "a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574";
  var SCAN_EVERY_MS = 2e3;
  var DOM_COOLDOWN_MS = 3 * 60 * 1e3;
  var sent = /* @__PURE__ */ new Set();
  var muted = false;
  function pageWindow() {
    try {
      return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    } catch {
      return window;
    }
  }
  function bitrixLogin() {
    const m = document.cookie.match(/(?:^|;\s*)BITRIX_SM_UIDL=([^;]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  var ENDING = /end|finish|destroy|hangup|complete|cancel/i;
  function watchPull() {
    const BX = pageWindow().BX;
    if (!BX || typeof BX.addCustomEvent !== "function") return false;
    BX.addCustomEvent("onPullEvent", (moduleId, command, params) => {
      const where = `${moduleId} ${command}`;
      if (!/vox|telephon|call/i.test(where)) return;
      console.log("[SPOT] событие телефонии:", moduleId, command, params);
      if (ENDING.test(String(command))) return;
      const call = fromPullParams(params);
      if (call && !sent.has(call.callId)) {
        sent.add(call.callId);
        console.log("[SPOT] увидел звонок (событие):", call);
        report(call);
      }
    });
    return true;
  }
  function fromPullParams(params) {
    for (const raw of [params, params?.call, params?.CALL, params?.data, params?.PARAMS]) {
      const call = raw && parseCallOption(raw);
      if (call) return call;
    }
    return null;
  }
  function readOptions() {
    return [...document.querySelectorAll('input[name="PLACEMENT_OPTIONS"]')].map((input) => input.value);
  }
  var CARD_SELECTOR = [
    '[class*="call-card"]',
    '[class*="callcard"]',
    '[class*="call_card"]',
    '[class*="callCard"]',
    ".bx-call-view",
    ".crm-call-card"
  ].join(", ");
  var domSeen = /* @__PURE__ */ new Map();
  var cardAt = 0;
  function readCard() {
    if (Date.now() - cardAt < SCAN_EVERY_MS) return null;
    cardAt = Date.now();
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      const text = card.innerText || "";
      if (!/входящ/i.test(text)) continue;
      const phone = (text.match(/\+?\d[\d\s\-()]{9,}\d/) || [])[0];
      if (!phone) continue;
      const digits = phone.replace(/\D+/g, "");
      const at = domSeen.get(digits) || 0;
      if (Date.now() - at < DOM_COOLDOWN_MS) continue;
      domSeen.set(digits, Date.now());
      const link = card.querySelector('a[href*="/crm/lead/details/"]') || document.querySelector('a[href*="/crm/lead/details/"]');
      const leadId = (link?.getAttribute("href")?.match(/\/crm\/lead\/details\/(\d+)\//) || [])[1] || null;
      return {
        callId: `dom:${digits}:${Math.floor(Date.now() / 1e3)}`,
        startedAt: Date.now(),
        phone: digits,
        line: null,
        direction: "incoming",
        leadId
      };
    }
    return null;
  }
  function report(call) {
    const login = bitrixLogin();
    if (!login) {
      console.warn("[SPOT] не вижу логин Битрикса в куках — звонок не отправлен");
      return;
    }
    GM_xmlhttpRequest({
      method: "POST",
      url: `${API_BASE}/api/bitrix/sensor`,
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
      data: JSON.stringify({ ...call, bitrixLogin: login }),
      onload(res) {
        let answer = null;
        try {
          answer = JSON.parse(res.responseText || "{}");
        } catch {
        }
        if (answer && answer.ok === false && answer.reason === "not_linked") {
          muted = true;
          console.warn("[SPOT] учётка Битрикса не привязана к аккаунту сайта — войдите в Битрикс через сайт, тогда звонки начнут всплывать");
          return;
        }
        if (!answer || !answer.ok) {
          sent.delete(call.callId);
          return;
        }
        console.log(`[SPOT] звонок передан сайту: ${call.phone || "номер неизвестен"}${call.leadId ? `, лид ${call.leadId}` : ", лида пока нет"}`);
      },
      onerror() {
        sent.delete(call.callId);
      },
      ontimeout() {
        sent.delete(call.callId);
      }
    });
  }
  var firstScan = true;
  var pullReady = false;
  function scan() {
    if (muted) return;
    if (!pullReady) pullReady = watchPull();
    if (!bitrixLogin()) return;
    const call = pickCurrentCall(readOptions(), { known: sent, firstScan }) || readCard();
    firstScan = false;
    if (!call || sent.has(call.callId)) return;
    sent.add(call.callId);
    console.log("[SPOT] увидел звонок:", call);
    report(call);
  }
  new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, SCAN_EVERY_MS);
  scan();
  try {
    pageWindow().SPOT = {
      dump() {
        const cards = [...document.querySelectorAll(CARD_SELECTOR)];
        const out = {
          логин: bitrixLogin(),
          формы: readOptions(),
          событияТелефонии: pullReady ? "слушаю" : "BX.addCustomEvent не найден",
          карточек: cards.length,
          классы: cards.map((c) => c.className).slice(0, 10),
          тексты: cards.map((c) => (c.innerText || "").slice(0, 200)).slice(0, 5),
          ссылкиНаЛиды: [...document.querySelectorAll('a[href*="/crm/lead/details/"]')].map((a) => a.getAttribute("href")).slice(0, 10),
          отправлено: [...sent]
        };
        console.log("[SPOT] осмотр:", out);
        return out;
      }
    };
  } catch {
  }
  console.log("[SPOT] датчик звонков Битрикса запущен (события телефонии + форма + карточка)");
})();
