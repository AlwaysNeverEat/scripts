// ==UserScript==
// @name         SPOT DB Notifier
// @namespace    zamena-masla-spot.ru
// @version      1.2.561
// @description  Проверяет найденную машину в базе рассчитанных: «✓ эта машина уже рассчитана» → клик открывает страницу машины на сайте
// @match        https://www.mann-filter.com/*
// @match        https://mann-filter.com/*
// @match        https://lynxauto.info/*
// @match        https://podbor.ravenol.ru/*
// @grant        GM_xmlhttpRequest
// @connect      cars-db-backend.onrender.com
// @connect      localhost
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20DB%20Notifier-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20DB%20Notifier-1.0.user.js
// ==/UserScript==

(() => {
  // shared/sourceLinks.js
  function detectSite(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const h = u.hostname.toLowerCase();
    if (h.includes("mann-filter.com")) return "mann";
    if (h.includes("lynxauto.info")) return "lynx";
    if (h.includes("ravenol.ru")) return "ravenol";
    if (h.includes("motul.lubricantadvisor.com")) return "motul";
    if (h.includes("lukoil.lubribase.ru")) return "lukoil";
    return null;
  }
  function normPart(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/\+/g, " ").replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  }
  function sourceSignature(url) {
    const site = detectSite(url);
    if (!site) return null;
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const p = u.searchParams;
    if (site === "mann") {
      const id = p.get("vehicleTypeId") || p.get("modelTypeId");
      const digits = (id || "").replace(/\D/g, "").replace(/^0+/, "");
      if (digits) return "mann:type:" + digits;
      const parts = [
        p.get("vehicleMake"),
        p.get("vehicleModel"),
        p.get("ccm"),
        p.get("kw"),
        p.get("engineCode")
      ].map(normPart).filter(Boolean);
      return parts.length ? "mann:" + parts.join(":") : null;
    }
    if (site === "lynx") {
      const parts = [p.get("vendor"), p.get("car"), p.get("modification")].map(normPart).filter(Boolean);
      return parts.length ? "lynx:" + parts.join(":") : null;
    }
    if (site === "ravenol") {
      const path = normPart(u.pathname);
      return path ? "ravenol:" + path : null;
    }
    if (site === "lukoil") {
      const parts = [p.get("manufacturer_id"), p.get("engine_volume")].map(normPart).filter(Boolean);
      return parts.length ? "lukoil:" + parts.join(":") : null;
    }
    return null;
  }

  // userscript/src/notifier/app.js
  var API_BASE = "https://cars-db-backend.onrender.com";
  var API_KEY = "a56817cfece2ca6ad4bfdf7c2a7b83e1df99184d09daf574";
  var SITE_URL = "https://alwaysnevereat.github.io/scripts";
  var CHECK_INTERVAL_MS = 1500;
  var REQUEST_TIMEOUT_MS = 6e4;
  var RETRY_DELAYS_MS = [5e3, 15e3, 3e4];
  var NOTFOUND_TTL_MS = 5 * 60 * 1e3;
  var checked = /* @__PURE__ */ new Map();
  var retries = /* @__PURE__ */ new Map();
  function apiMatch(sig) {
    const params = new URLSearchParams();
    params.set("source_key", sig);
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `${API_BASE}/api/cars/match?${params}`,
        headers: { "x-api-key": API_KEY },
        timeout: REQUEST_TIMEOUT_MS,
        onload: (resp) => {
          if (resp.status === 200) {
            try {
              const record = JSON.parse(resp.responseText);
              if (record && record.id) {
                resolve({ status: "found", record });
                return;
              }
            } catch {
            }
            resolve({ status: "error" });
            return;
          }
          if (resp.status === 404) {
            resolve({ status: "notfound" });
            return;
          }
          resolve({ status: "error" });
        },
        onerror: () => resolve({ status: "error" }),
        ontimeout: () => resolve({ status: "error" })
      });
    });
  }
  function removeBanner() {
    const el = document.getElementById("spot-db-banner");
    if (el) el.remove();
  }
  function showBanner(record) {
    removeBanner();
    const carUrl = `${SITE_URL}/#/car/${record.id}`;
    const title = [record.brand, record.model, record.engine_name || record.engine_volume].filter(Boolean).join(" ");
    const el = document.createElement("div");
    el.id = "spot-db-banner";
    el.innerHTML = `
        <div class="sdb-check">✓</div>
        <div class="sdb-text">
            <div class="sdb-title">Эта машина уже рассчитана</div>
            <div class="sdb-sub">${escapeHtml(title)} — открыть расчёт ↗</div>
        </div>
        <button class="sdb-close" title="Скрыть">✕</button>
    `;
    el.style.cssText = `
        position:fixed;bottom:18px;left:18px;z-index:2147483647;
        display:flex;align-items:center;gap:10px;
        background:#0f1117;color:#e8eaf6;border:1px solid #43a047;border-radius:12px;
        padding:12px 16px;font:13px Arial;cursor:pointer;
        box-shadow:0 8px 32px rgba(0,0,0,.55);max-width:340px`;
    if (!document.getElementById("spot-db-style")) {
      const st = document.createElement("style");
      st.id = "spot-db-style";
      st.textContent = `
            #spot-db-banner:hover{border-color:#66bb6a;box-shadow:0 8px 32px rgba(67,160,71,.35)}
            #spot-db-banner .sdb-check{width:28px;height:28px;border-radius:50%;flex:none;
                background:#1b5e20;color:#a5d6a7;display:flex;align-items:center;
                justify-content:center;font-size:16px;font-weight:bold}
            #spot-db-banner .sdb-title{font-weight:bold;color:#81c784}
            #spot-db-banner .sdb-sub{font-size:11px;color:#9aa0b0;margin-top:2px}
            #spot-db-banner .sdb-close{background:none;border:none;color:#5a6070;
                cursor:pointer;font-size:13px;padding:4px;flex:none}
            #spot-db-banner .sdb-close:hover{color:#e8eaf6}
        `;
      document.head.appendChild(st);
    }
    el.querySelector(".sdb-close").onclick = (e) => {
      e.stopPropagation();
      checked.set("dismissed_" + record.id, true);
      removeBanner();
    };
    el.onclick = () => window.open(carUrl, "_blank");
    document.body.appendChild(el);
  }
  async function checkCurrentCar() {
    const key = sourceSignature(location.href);
    if (!key) {
      removeBanner();
      return;
    }
    const state = checked.get(key);
    if (state === "pending") return;
    if (state && state.record) {
      if (!checked.get("dismissed_" + state.record.id) && !document.getElementById("spot-db-banner")) {
        showBanner(state.record);
      }
      return;
    }
    if (state && state.notFoundAt && Date.now() - state.notFoundAt < NOTFOUND_TTL_MS) return;
    checked.set(key, "pending");
    const res = await apiMatch(key);
    if (res.status === "found") {
      retries.delete(key);
      checked.set(key, { record: res.record });
      if (!checked.get("dismissed_" + res.record.id)) showBanner(res.record);
      return;
    }
    removeBanner();
    if (res.status === "notfound") {
      retries.delete(key);
      checked.set(key, { notFoundAt: Date.now() });
      return;
    }
    checked.delete(key);
    const attempt = retries.get(key) || 0;
    if (attempt < RETRY_DELAYS_MS.length) {
      retries.set(key, attempt + 1);
      setTimeout(() => {
        if (sourceSignature(location.href) === key) checkCurrentCar();
      }, RETRY_DELAYS_MS[attempt]);
    }
  }
  if (typeof location !== "undefined" && typeof document !== "undefined") {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        removeBanner();
        checkCurrentCar();
      }
    }, CHECK_INTERVAL_MS);
    checkCurrentCar();
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }
})();
