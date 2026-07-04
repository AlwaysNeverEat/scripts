// ==UserScript==
// @name         SPOT DB Notifier
// @namespace    zamena-masla-spot.ru
// @version      1.1.86
// @description  Проверяет найденную машину в базе рассчитанных: «✓ эта машина уже рассчитана» → клик открывает страницу машины на сайте
// @match        https://www.mann-filter.com/*
// @match        https://mann-filter.com/*
// @match        https://lynxauto.info/*
// @grant        GM_xmlhttpRequest
// @connect      cars-db-backend.onrender.com
// @connect      localhost
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20DB%20Notifier-1.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20DB%20Notifier-1.0.user.js
// ==/UserScript==

(() => {
  // userscript/src/parsers.js
  function parseMannUrl() {
    if (location.hostname.includes("lynxauto.info")) {
      return parseLynxUrl();
    }
    const p = new URLSearchParams(location.search);
    if (!p.get("vehicleMake") && !p.get("vehicleModel")) return null;
    const make = (p.get("vehicleMake") || "").trim();
    const model = (p.get("vehicleModel") || "").replace(/\+/g, " ").trim();
    const engineCode = (p.get("engineCode") || "").replace(/\+/g, " ").trim();
    const fuelType = (p.get("fuelType") || "").trim();
    const ccm = parseInt(p.get("ccm") || "0") || null;
    const kw = parseInt(p.get("kw") || "0") || null;
    const bhp = parseInt(p.get("bhp") || "0") || null;
    const yMatch = (p.get("vehicleManufacturedFrom") || "").match(/(\d{4})/);
    const yearFrom = yMatch ? parseInt(yMatch[1]) : null;
    const makeShort = make.split(/\s+/)[0];
    const modelShort = model.replace(/\([^)]*\)/g, " ").replace(/[()]/g, " ").replace(/\s{2,}/g, " ").trim().split(/\s+/).slice(0, 3).join(" ");
    const volume = ccm ? (Math.round(ccm / 100) / 10).toFixed(1) : "";
    const query = [makeShort, modelShort, volume].filter(Boolean).join(" ").toLowerCase();
    const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom].filter(Boolean).join("_").toLowerCase().replace(/\s+/g, "");
    return {
      make,
      model,
      makeShort,
      modelShort,
      engineCode,
      fuelType,
      ccm,
      kw,
      bhp,
      yearFrom,
      volume,
      query,
      cacheKey
    };
  }
  function parseLynxUrl() {
    const p = new URLSearchParams(location.search);
    const vendor = (p.get("vendor") || "").trim();
    const car = (p.get("car") || "").replace(/\+/g, " ").trim();
    const yearRaw = (p.get("year") || "").replace(/\+/g, " ").trim();
    const mod = (p.get("modification") || "").replace(/\+/g, " ").trim();
    const power = (p.get("power_engine") || "").replace(/\+/g, " ").trim();
    if (!vendor || !car) return null;
    let engineCode = "", engineName = mod;
    const ecMatch = mod.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (ecMatch) {
      engineName = ecMatch[1].trim();
      engineCode = ecMatch[2].trim();
    }
    let yearFrom = null;
    const yMatch = yearRaw.match(/(\d{1,2})\/(\d{2,4})/);
    if (yMatch) {
      let y = parseInt(yMatch[2]);
      if (y < 100) y += y < 50 ? 2e3 : 1900;
      yearFrom = y;
    }
    let kw = null, bhp = null;
    const pMatch = power.match(/(\d+)\s*\((\d+)\)/);
    if (pMatch) {
      kw = parseInt(pMatch[1]);
      bhp = parseInt(pMatch[2]);
    } else {
      const single = power.match(/(\d+)/);
      if (single) kw = parseInt(single[1]);
    }
    const modelClean = car.replace(/\([^)]*\)/g, " ").replace(/\s+\d{1,2}[\/\-]\d{0,4}-?\s*$/g, "").replace(/\s+\d{1,2}-\s*$/g, "").replace(/[-\s]+$/g, "").replace(/\s{2,}/g, " ").trim();
    let volume = "";
    const skipVolume = /^(BMW|MERCEDES|MERCEDES-BENZ)$/i.test(vendor);
    if (!skipVolume) {
      const volMatch = engineName.match(/(\d\.\d)/);
      if (volMatch) volume = volMatch[1];
    }
    const make = vendor;
    const makeShort = make.split(/\s+/)[0];
    const modelShort = modelClean.split(/\s+/).slice(0, 3).join(" ") || car;
    const queryParts = [makeShort, modelShort];
    if (engineName) queryParts.push(engineName);
    else if (volume) queryParts.push(volume);
    const query = queryParts.filter(Boolean).join(" ").toLowerCase();
    const cacheKey = [makeShort, modelShort, volume, kw, engineCode, yearFrom].filter(Boolean).join("_").toLowerCase().replace(/\s+/g, "");
    let fuelType = "";
    const allText = (engineName + " " + engineCode).toUpperCase();
    if (/\bD\b|DCI|TDI|HDI|CDI|CRDI|TDCI|TDDI|JTD|MULTIJET|DTI|CTDI|D-?4D|SDI|\bTD\b/i.test(allText)) {
      fuelType = "05";
    }
    return {
      make,
      model: car,
      makeShort,
      modelShort,
      engineCode,
      engineName,
      fuelType,
      ccm: null,
      kw,
      bhp,
      yearFrom,
      volume,
      query,
      cacheKey
    };
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
  function apiMatch(car) {
    const params = new URLSearchParams();
    if (car.engineCode) params.set("engine_code", car.engineCode);
    if (car.makeShort) params.set("brand", car.makeShort);
    if (car.modelShort) params.set("model", car.modelShort);
    if (car.yearFrom) params.set("year", String(car.yearFrom));
    if (car.volume) params.set("volume", String(car.volume));
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
    const car = parseMannUrl();
    if (!car) {
      removeBanner();
      return;
    }
    const key = car.cacheKey;
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
    const res = await apiMatch(car);
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
        const cur = parseMannUrl();
        if (cur && cur.cacheKey === key) checkCurrentCar();
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
