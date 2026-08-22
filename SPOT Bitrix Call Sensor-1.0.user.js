// ==UserScript==
// @name         SPOT Bitrix — датчик звонков
// @namespace    k-spot.ru
// @version      1.0.657
// @description  Сообщает сайту, что пришёл входящий звонок и какой лид Битрикс с ним связал. Ничего не читает и не меняет — только сообщает факт.
// @match        https://spotexpress.bitrix24.ru/*
// @grant        GM_xmlhttpRequest
// @connect      k-spot.ru
// @connect      localhost
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20Bitrix%20Call%20Sensor-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20Bitrix%20Call%20Sensor-1.0.user.js
// ==/UserScript==

(() => {
  // userscript/src/bitrix-call/app.js
  var API_BASE = "https://k-spot.ru";
  var API_KEY = "a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574";
  var SCAN_EVERY_MS = 2e3;
  var sent = /* @__PURE__ */ new Set();
  var muted = false;
  function bitrixLogin() {
    const m = document.cookie.match(/(?:^|;\s*)BITRIX_SM_UIDL=([^;]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  function readCalls() {
    const found = [];
    for (const input of document.querySelectorAll('input[name="PLACEMENT_OPTIONS"]')) {
      let data;
      try {
        data = JSON.parse(input.value || "{}");
      } catch {
        continue;
      }
      if (!data || !data.CALL_ID) continue;
      found.push({
        callId: String(data.CALL_ID),
        phone: data.PHONE_NUMBER ? String(data.PHONE_NUMBER) : null,
        line: data.LINE_NUMBER ? String(data.LINE_NUMBER) : null,
        direction: data.CALL_DIRECTION ? String(data.CALL_DIRECTION) : "incoming",
        // Лида может ещё не быть (звонок с неизвестного номера в первую
        // секунду) — тогда шлём звонок без него, сайт покажет номер.
        leadId: data.CRM_ENTITY_TYPE === "LEAD" && data.CRM_ENTITY_ID ? String(data.CRM_ENTITY_ID) : null
      });
    }
    return found;
  }
  function report(call, login) {
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
  function scan() {
    if (muted) return;
    const login = bitrixLogin();
    if (!login) return;
    for (const call of readCalls()) {
      if (sent.has(call.callId)) continue;
      sent.add(call.callId);
      console.log("[SPOT] увидел звонок:", call);
      report(call, login);
    }
  }
  new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, SCAN_EVERY_MS);
  scan();
  console.log("[SPOT] датчик звонков Битрикса запущен");
})();
