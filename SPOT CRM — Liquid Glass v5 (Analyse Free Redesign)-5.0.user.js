// ==UserScript==
// @name         SPOT CRM — Liquid Glass v5 (Analyse Free Redesign)
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Liquid glass редизайн SPOT CRM — analyse/free, dial_clients, клиенты и чеки услуги
// @match        *://*/analyse/free*
// @match        *://*/dial_clients*
// @match        *://*/clients/*
// @match        *://*/sale/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20CRM%20%E2%80%94%20Liquid%20Glass%20v5%20(Analyse%20Free%20Redesign)-5.0.user.js
// @downloadURL  https://raw.githubusercontent.com/AlwaysNeverEat/scripts/main/SPOT%20CRM%20%E2%80%94%20Liquid%20Glass%20v5%20(Analyse%20Free%20Redesign)-5.0.user.js
// ==/UserScript==

(function($) {
'use strict';

/* ─────────────────────────────────────────────
   PAGE DETECTION
───────────────────────────────────────────── */
var pageType = (function() {
    var p = (location.pathname || '').replace(/\/+$/, '/');
    if (p.indexOf('/analyse/free') === 0)   return 'analyse';
    if (p.indexOf('/dial_clients') === 0)   return 'dial_clients';
    if (/^\/clients\/\d+/.test(p))          return 'client_sales';
    if (/^\/sale\/\d+/.test(p))             return 'sale';
    return 'unknown';
})();
document.documentElement.setAttribute('data-zm-page', pageType);

/* ─────────────────────────────────────────────
   ШРИФТ
───────────────────────────────────────────── */
$('<link>', {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap'
}).appendTo('head');

/* ─────────────────────────────────────────────
   CSS
───────────────────────────────────────────── */
$('<style id="spot-crm-glass-v5">').text(`

    :root {
        /* Фон */
        --bg-deep:     #0a0e1a;
        --bg-base:     #0f1420;
        --bg-1:        #141a2c;
        --bg-2:        #1a2138;

        /* СТЕКЛО — без backdrop-filter, через multi-layer fill */
        --gl-fill-1:   linear-gradient(135deg, rgba(40, 56, 100, 0.35) 0%, rgba(28, 38, 70, 0.55) 100%);
        --gl-fill-2:   linear-gradient(135deg, rgba(50, 70, 120, 0.40) 0%, rgba(36, 50, 90, 0.60) 100%);
        --gl-fill-3:   linear-gradient(135deg, rgba(64, 86, 140, 0.55) 0%, rgba(48, 65, 110, 0.75) 100%);

        --gl-bord:     rgba(150, 180, 240, 0.18);
        --gl-bord-hi:  rgba(150, 180, 240, 0.32);
        --gl-inner:    rgba(255, 255, 255, 0.08);
        --gl-inner-2:  rgba(255, 255, 255, 0.04);

        /* Solid fills для мелких элементов (chips, button bg, hover) */
        --gl-1:        rgba(40, 56, 100, 0.50);
        --gl-2:        rgba(56, 76, 130, 0.55);
        --gl-3:        rgba(80, 105, 165, 0.65);

        /* Акценты */
        --acc:         #7dd3fc;
        --acc-hi:      #38bdf8;
        --acc-soft:    rgba(125, 211, 252, 0.16);
        --acc-glow:    rgba(125, 211, 252, 0.40);

        --pur:         #c4b5fd;
        --pur-glow:    rgba(196, 181, 253, 0.35);

        /* Текст */
        --txt-hi:      #e8edf7;
        --txt-mid:     #a5b0c8;
        --txt-lo:      #6b7892;
        --txt-mute:    #4a5568;

        /* Статусы */
        --ok:          #6ee7b7;
        --warn:        #fcd34d;
        --bad:         #fca5a5;

        /* Радиусы */
        --r-sm:        8px;
        --r-md:        12px;
        --r-lg:        16px;
        --r-xl:        22px;
        --r-full:      9999px;
    }

    /* СВЕТЛАЯ ТЕМА — НОВАЯ (clean + contrast) */
body.zm-theme-light {
    /* ФОН — почти белый, но не стерильный */
    --bg-deep:     #ffffff;
    --bg-base:     #f8fafc;
    --bg-1:        #f1f5f9;
    --bg-2:        #e2e8f0;

    /* СТЕКЛО — лёгкое, воздушное */
    --gl-fill-1:   linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(248,250,252,0.7) 100%);
    --gl-fill-2:   linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(241,245,249,0.8) 100%);
    --gl-fill-3:   linear-gradient(135deg, rgba(255,255,255,1) 0%, rgba(241,245,249,0.9) 100%);

    /* ГРАНИЦЫ — дают читаемость */
    --gl-bord:     rgba(15, 23, 42, 0.06);
    --gl-bord-hi:  rgba(15, 23, 42, 0.14);

    /* ВНУТРЕННИЙ СВЕТ */
    --gl-inner:    rgba(255, 255, 255, 0.95);
    --gl-inner-2:  rgba(255, 255, 255, 0.7);

    /* SOLID — важно: не одинаковые */
    --gl-1:        #ffffff;
    --gl-2:        #f8fafc;
    --gl-3:        #eef2f7;

    /* АКЦЕНТ — ярче, чем в тёмной, чтобы не терялся */
    --acc:         #2563eb;
    --acc-hi:      #1d4ed8;
    --acc-soft:    rgba(37, 99, 235, 0.12);
    --acc-glow:    rgba(37, 99, 235, 0.30);

    /* Вторичный акцент */
    --pur:         #7c3aed;
    --pur-glow:    rgba(124, 58, 237, 0.25);

    /* ТЕКСТ — сильный контраст */
    --txt-hi:      #0b1220;
    --txt-mid:     #334155;
    --txt-lo:      #64748b;
    --txt-mute:    #94a3b8;

    /* СТАТУСЫ — чуть насыщеннее */
    --ok:          #16a34a;
    --warn:        #d97706;
    --bad:         #dc2626;
}
    *, *::before, *::after { box-sizing: border-box; }

    html {
        background: var(--bg-deep) !important;
    }
    body {
        background: transparent !important;
        color: var(--txt-hi) !important;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
        font-size: 14px !important;
        -webkit-font-smoothing: antialiased !important;
        -moz-osx-font-smoothing: grayscale !important;
        margin: 0 !important;
        padding: 0 !important;
        min-height: 100vh !important;
        overflow-x: hidden !important;
    }

    /* Фоновые блобы — z-index очень глубоко чтобы canvas был сверху */
    body::before {
        content: '';
        position: fixed;
        inset: 0;
        z-index: -10;
        pointer-events: none;
        background:
            radial-gradient(circle 600px at 10% 5%, rgba(125, 211, 252, 0.18) 0%, transparent 50%),
            radial-gradient(circle 700px at 90% 15%, rgba(196, 181, 253, 0.16) 0%, transparent 50%),
            radial-gradient(circle 500px at 75% 70%, rgba(125, 211, 252, 0.12) 0%, transparent 50%),
            radial-gradient(circle 600px at 20% 95%, rgba(196, 181, 253, 0.14) 0%, transparent 55%),
            linear-gradient(170deg, var(--bg-deep) 0%, var(--bg-base) 100%);
        background-attachment: fixed;
    }
    body.zm-theme-light::before {
        background:
            radial-gradient(circle 600px at 10% 5%, rgba(2, 132, 199, 0.10) 0%, transparent 50%),
            radial-gradient(circle 700px at 90% 15%, rgba(124, 58, 237, 0.08) 0%, transparent 50%),
            radial-gradient(circle 500px at 75% 70%, rgba(2, 132, 199, 0.07) 0%, transparent 50%),
            radial-gradient(circle 600px at 20% 95%, rgba(124, 58, 237, 0.08) 0%, transparent 55%),
            linear-gradient(170deg, var(--bg-deep) 0%, var(--bg-base) 100%);
    }

    /* Canvas — между фоном и контентом */
    #zm-particles {
        position: fixed !important;
        inset: 0 !important;
        z-index: 0 !important;
        pointer-events: none !important;
        opacity: 1;
    }
    body.zm-theme-light #zm-particles { opacity: 0.6; }

    /* Весь контент должен быть выше canvas */
    .zm-app { position: relative !important; z-index: 1 !important; }

    /* ── СКРЫВАЕМ ДЕФОЛТ ────────────────────── */
    body > .page > .header,
    body > .page > .content > .left-container,
    body > .page > .content > .main-container > .page_header,
    body > .page > .content > .btn_left_menu,
    body > .page > .content > input#pseudo-btn,
    body > .page > .content > .main-container > .table_wrapper > form > input[type="hidden"]:not(.update_all_items) {
        display: none !important;
    }
    /* Скрываем "Описание раздела" + "Сохранить" / sms-форму везде, но h3 — только на /analyse */
    .left-container > form[action="/edit"],
    .left-container > form.sms-send-form,
    .left-container > h3[style*="margin-bottom"] {
        display: none !important;
    }
    html[data-zm-page="analyse"] .left-container > h3 {
        display: none !important;
    }

    /* ═════════════════════════════════════════
       APP SHELL — наш кастомный layout
    ═════════════════════════════════════════ */
    .zm-app {
        display: grid !important;
        grid-template-columns: 260px 1fr !important;
        min-height: 100vh !important;
        gap: 0 !important;
        position: relative !important;
        z-index: 1 !important;
    }

    /* ── SIDEBAR ───────────────────────────── */
    .zm-sidebar {
        background: var(--gl-fill-1) !important;
        border-right: 1px solid var(--gl-bord) !important;
        box-shadow:
            inset 1px 1px 0 var(--gl-inner),
            inset -1px 0 0 var(--gl-bord),
            inset 0 -1px 0 var(--gl-bord),
            4px 0 24px rgba(0, 0, 0, 0.20) !important;
        padding: 22px 18px !important;
        position: sticky !important;
        top: 0 !important;
        height: 100vh !important;
        display: flex !important;
        flex-direction: column !important;
        overflow-y: auto !important;
        animation: zmFadeR .5s cubic-bezier(.4,0,.2,1) both !important;
    }
    /* Glow на верхнем углу — имитирует подсветку света на стекле */
    .zm-sidebar::before {
        content: '';
        position: absolute;
        top: 0; left: 0;
        width: 60%; height: 200px;
        background: radial-gradient(ellipse at top left, rgba(125, 211, 252, 0.10) 0%, transparent 60%);
        pointer-events: none;
        z-index: 0;
    }
    .zm-sidebar > * { position: relative; z-index: 1; }

    .zm-logo {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 8px 6px 22px 6px !important;
        margin-bottom: 18px !important;
        border-bottom: 1px solid var(--gl-bord) !important;
    }
    .zm-logo-mark {
        width: 38px; height: 38px;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--acc) 0%, var(--pur) 100%);
        display: grid;
        place-items: center;
        color: #0a0e1a;
        font-weight: 800;
        font-size: 16px;
        box-shadow: 0 4px 14px var(--acc-glow);
        flex-shrink: 0;
    }
    .zm-logo-txt {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .zm-logo-txt-1 {
        font-weight: 800;
        font-size: 15px;
        color: var(--txt-hi);
        letter-spacing: -0.01em;
    }
    .zm-logo-txt-2 {
        font-size: 10px;
        color: var(--txt-lo);
        text-transform: uppercase;
        letter-spacing: 0.12em;
    }

    .zm-nav {
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
    }
    .zm-nav-section {
        font-size: 10px !important;
        color: var(--txt-mute) !important;
        text-transform: uppercase !important;
        letter-spacing: 0.12em !important;
        padding: 14px 12px 6px !important;
        font-weight: 600 !important;
    }
    .zm-nav-item {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 10px 12px !important;
        border-radius: var(--r-md) !important;
        color: var(--txt-mid) !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        text-decoration: none !important;
        transition: all .2s cubic-bezier(.4,0,.2,1) !important;
        position: relative !important;
        cursor: pointer !important;
    }
    .zm-nav-item-icon {
        width: 22px;
        height: 22px;
        opacity: 0.85;
        flex-shrink: 0;
        transition: all .2s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        line-height: 1;
    }
    .zm-nav-item-icon svg {
        width: 18px;
        height: 18px;
        stroke: currentColor;
        stroke-width: 1.8;
        fill: none;
    }
    .zm-nav-item:hover {
        background: var(--gl-2) !important;
        color: var(--txt-hi) !important;
    }
    .zm-nav-item:hover .zm-nav-item-icon { opacity: 1; }
    .zm-nav-item.is-active {
        background: var(--acc-soft) !important;
        color: var(--acc) !important;
    }
    .zm-nav-item.is-active::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 60%;
        background: var(--acc);
        border-radius: 0 3px 3px 0;
        box-shadow: 0 0 8px var(--acc-glow);
    }
    .zm-nav-item.is-active .zm-nav-item-icon { opacity: 1; }

    /* Группа с подменю */
    .zm-nav-group {
        display: flex !important;
        flex-direction: column !important;
    }
    .zm-nav-group-head {
        cursor: pointer !important;
    }
    .zm-nav-chev {
        width: 16px !important;
        height: 16px !important;
        margin-left: auto !important;
        opacity: 0.5 !important;
        transition: transform .25s cubic-bezier(.4,0,.2,1), opacity .2s !important;
        flex-shrink: 0 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
    }
    .zm-nav-chev svg {
        width: 14px;
        height: 14px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
    }
    .zm-nav-group.is-open .zm-nav-chev {
        transform: rotate(180deg) !important;
        opacity: 1 !important;
    }
    .zm-nav-group:hover .zm-nav-chev {
        opacity: 1 !important;
    }

    .zm-nav-sub {
        max-height: 0 !important;
        opacity: 0 !important;
        overflow: hidden !important;
        transition: all .3s cubic-bezier(.4,0,.2,1) !important;
        margin-left: 14px !important;
        padding-left: 14px !important;
        border-left: 1px solid var(--gl-bord) !important;
    }
    .zm-nav-group.is-open .zm-nav-sub {
        max-height: 500px !important;
        opacity: 1 !important;
        padding-top: 4px !important;
        padding-bottom: 4px !important;
    }
    .zm-nav-sub-item {
        padding: 8px 12px !important;
        font-size: 12px !important;
    }
    .zm-nav-sub-item .zm-nav-item-icon {
        width: 14px !important;
        height: 14px !important;
    }
    .zm-nav-sub-item .zm-nav-item-icon svg {
        width: 12px !important;
        height: 12px !important;
    }
    .zm-nav-sub-item.is-active::before {
        height: 50% !important;
    }

    .zm-sidebar-spacer { flex: 1; }

    .zm-user-card {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 10px !important;
        background: var(--gl-2) !important;
        border: 1px solid var(--gl-bord) !important;
        border-radius: var(--r-md) !important;
        margin-top: 14px !important;
        transition: all .2s !important;
    }
    .zm-user-card:hover {
        background: var(--gl-3) !important;
        border-color: var(--gl-bord-hi) !important;
    }
    .zm-user-avatar {
        width: 36px; height: 36px;
        border-radius: 50%;
        border: 2px solid var(--acc);
        object-fit: cover;
        box-shadow: 0 0 0 2px var(--bg-base), 0 0 12px var(--acc-glow);
        flex-shrink: 0;
    }
    .zm-user-info {
        flex: 1;
        min-width: 0;
    }
    .zm-user-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--txt-hi);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .zm-user-station {
        font-size: 11px;
        color: var(--txt-lo);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .zm-user-logout {
        background: transparent !important;
        border: none !important;
        padding: 6px !important;
        border-radius: var(--r-sm) !important;
        color: var(--txt-lo) !important;
        cursor: pointer !important;
        opacity: 0.7;
        transition: all .2s;
        flex-shrink: 0;
        line-height: 1 !important;
        text-transform: none !important;
        box-shadow: none !important;
        position: relative !important;
        overflow: hidden !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 32px !important;
        height: 32px !important;
    }
    .zm-user-logout::before { display: none !important; content: none !important; }
    .zm-user-logout svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        stroke-width: 2;
        fill: none;
    }
    .zm-user-logout:hover {
        opacity: 1;
        background: var(--gl-3) !important;
        color: var(--bad) !important;
        transform: none !important;
        box-shadow: none !important;
        filter: none !important;
    }
    .zm-user-logout:hover::before { display: none !important; }

    /* ── MAIN ─────────────────────────────── */
    .zm-main {
        display: flex !important;
        flex-direction: column !important;
        min-height: 100vh !important;
        animation: zmFadeU .5s .1s cubic-bezier(.4,0,.2,1) both !important;
    }

    /* TOPBAR */
    .zm-topbar {
        position: sticky !important;
        top: 0 !important;
        z-index: 40 !important;
        background: var(--gl-fill-1) !important;
        border-bottom: 1px solid var(--gl-bord) !important;
        box-shadow:
            inset 0 1px 0 var(--gl-inner),
            0 4px 20px rgba(0, 0, 0, 0.20) !important;
        padding: 14px 28px !important;
        display: flex !important;
        align-items: center !important;
        gap: 16px !important;
    }
    /* Подсветка слева — лучик света */
    .zm-topbar::before {
        content: '';
        position: absolute;
        top: 0; left: 0;
        width: 35%; height: 100%;
        background: linear-gradient(90deg, rgba(125, 211, 252, 0.06) 0%, transparent 100%);
        pointer-events: none;
    }
    .zm-topbar > * { position: relative; z-index: 1; }
    .zm-page-title {
        font-size: 18px !important;
        font-weight: 700 !important;
        color: var(--txt-hi) !important;
        letter-spacing: -0.01em !important;
        margin: 0 !important;
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
    }
    .zm-page-station {
        font-size: 13px;
        color: var(--acc);
        font-weight: 500;
        padding: 4px 10px;
        background: var(--acc-soft);
        border: 1px solid var(--gl-bord-hi);
        border-radius: var(--r-full);
    }
    .zm-topbar-spacer { flex: 1; }

    .zm-theme-toggle {
        background: var(--gl-2) !important;
        border: 1px solid var(--gl-bord) !important;
        color: var(--txt-mid) !important;
        width: 38px !important; height: 38px !important;
        border-radius: var(--r-md) !important;
        display: grid !important;
        place-items: center !important;
        cursor: pointer !important;
        padding: 0 !important;
        transition: all .25s !important;
        text-transform: none !important;
        box-shadow: none !important;
        font-size: 16px !important;
        position: relative !important;
        overflow: hidden !important;
    }
    .zm-theme-toggle::before { display: none !important; content: none !important; }
    .zm-theme-toggle:hover {
        background: var(--gl-3) !important;
        border-color: var(--acc) !important;
        color: var(--acc) !important;
        transform: translateY(-1px) !important;
        box-shadow: none !important;
        filter: none !important;
    }
    .zm-theme-toggle:hover::before { display: none !important; }
    .zm-theme-toggle svg {
        width: 18px;
        height: 18px;
        stroke: currentColor;
    }

    /* ── CONTENT WRAPPER ──────────────────── */
    .zm-content {
        padding: 24px 28px !important;
        flex: 1 !important;
    }

    /* ── PANEL — выдвижная секция фильтров ── */
    .zm-panel {
        background: var(--gl-fill-1) !important;
        border: 1px solid var(--gl-bord) !important;
        border-radius: var(--r-xl) !important;
        box-shadow:
            inset 0 1px 0 var(--gl-inner),
            inset 0 -1px 0 var(--gl-inner-2),
            0 8px 32px rgba(0, 0, 0, 0.20) !important;
        margin-bottom: 18px !important;
        overflow: hidden !important;
        transition: all .3s cubic-bezier(.4,0,.2,1) !important;
        position: relative !important;
    }
    /* Световой блик в верхнем правом углу */
    .zm-panel::after {
        content: '';
        position: absolute;
        top: 0; right: 0;
        width: 40%; height: 100%;
        background: radial-gradient(ellipse at top right, rgba(196, 181, 253, 0.10) 0%, transparent 60%);
        pointer-events: none;
        z-index: 0;
    }
    .zm-panel > * { position: relative; z-index: 1; }
    .zm-panel-header {
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        padding: 14px 20px !important;
        cursor: pointer !important;
        user-select: none !important;
        transition: background .2s !important;
    }
    .zm-panel-header:hover {
        background: var(--gl-2) !important;
    }
    .zm-panel-icon {
        width: 32px; height: 32px;
        border-radius: var(--r-md);
        background: var(--acc-soft);
        color: var(--acc);
        display: grid;
        place-items: center;
        font-size: 16px;
        flex-shrink: 0;
    }
    .zm-panel-title {
        font-weight: 600 !important;
        font-size: 14px !important;
        color: var(--txt-hi) !important;
        flex: 1 !important;
    }
    .zm-panel-meta {
        font-size: 12px;
        color: var(--txt-mid);
        margin-right: 8px;
    }
    .zm-panel-chev {
        color: var(--txt-mid) !important;
        transition: transform .3s cubic-bezier(.4,0,.2,1) !important;
        flex-shrink: 0 !important;
    }
    .zm-panel.is-open .zm-panel-chev {
        transform: rotate(180deg) !important;
        color: var(--acc) !important;
    }
    .zm-panel-body {
        max-height: 0 !important;
        opacity: 0 !important;
        overflow: hidden !important;
        transition: all .35s cubic-bezier(.4,0,.2,1) !important;
        padding: 0 20px !important;
        visibility: hidden !important;
    }
    .zm-panel.is-open .zm-panel-body {
        max-height: 800px !important;
        opacity: 1 !important;
        padding: 0 20px 18px 20px !important;
        visibility: visible !important;
    }
    /* Любые дочерние элементы Chosen / селекты внутри закрытой панели */
    .zm-panel:not(.is-open) .zm-panel-body * {
        visibility: hidden !important;
    }

    /* ── ТАБЛИЦА ───────────────────────────── */
    .zm-table-wrap {
        background: var(--gl-fill-1) !important;
        border: 1px solid var(--gl-bord) !important;
        border-radius: var(--r-xl) !important;
        overflow: hidden !important;
        box-shadow:
            inset 0 1px 0 var(--gl-inner),
            inset 0 -1px 0 var(--gl-inner-2),
            0 12px 40px rgba(0, 0, 0, 0.25) !important;
        position: relative !important;
    }
    /* Цветовая подсветка снизу слева — имитация преломления */
    .zm-table-wrap::after {
        content: '';
        position: absolute;
        bottom: 0; left: 0;
        width: 50%; height: 200px;
        background: radial-gradient(ellipse at bottom left, rgba(125, 211, 252, 0.08) 0%, transparent 70%);
        pointer-events: none;
        z-index: 0;
    }
    .zm-table-wrap > * { position: relative; z-index: 1; }
    .zm-table-header {
        padding: 16px 20px !important;
        border-bottom: 1px solid var(--gl-bord) !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
    }
    .zm-table-header-title {
        font-size: 14px !important;
        font-weight: 600 !important;
        color: var(--txt-hi) !important;
    }
    .zm-table-header-count {
        font-size: 12px;
        color: var(--txt-mid);
        padding: 2px 8px;
        background: var(--gl-2);
        border-radius: var(--r-full);
    }

    /* Сама таблица */
    .zm-table-wrap table.table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 13px !important;
    }
    .zm-table-wrap table.table thead td,
    .zm-table-wrap table.table thead th {
        background: rgba(40, 52, 88, 0.20) !important;
        color: var(--acc) !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.06em !important;
        padding: 12px 14px !important;
        border-bottom: 1px solid var(--gl-bord-hi) !important;
        text-align: center !important;
        white-space: nowrap !important;
    }
    .zm-table-wrap table.table thead td a {
        color: var(--acc) !important;
        text-decoration: none !important;
        transition: color .2s !important;
    }
    .zm-table-wrap table.table thead td a:hover { color: var(--txt-hi) !important; }

    .count-header {
        background: var(--acc-soft) !important;
        color: var(--acc) !important;
        font-weight: 700 !important;
    }

    .zm-table-wrap table.table .table__row {
        border-bottom: 1px solid var(--gl-bord) !important;
        transition: all .2s cubic-bezier(.4,0,.2,1) !important;
        animation: zmRowIn .3s ease both !important;
        background: transparent !important;
        opacity: 1 !important;
    }
    .zm-table-wrap table.table .table__row:nth-child(odd),
    .zm-table-wrap table.table .table__row:nth-child(even) {
        background: transparent !important;
        opacity: 1 !important;
    }
    .zm-table-wrap table.table .table__row:nth-child(even) {
        background: rgba(150, 180, 240, 0.025) !important;
    }
    .zm-table-wrap table.table .table__row > .table__cell {
        opacity: 1 !important;
        color: var(--txt-hi) !important;
    }
    .zm-table-wrap table.table .table__row:hover {
        background: var(--acc-soft) !important;
        box-shadow: inset 3px 0 0 var(--acc) !important;
    }
    table .table__row:nth-child(1)  { animation-delay:.04s !important }
    table .table__row:nth-child(2)  { animation-delay:.08s !important }
    table .table__row:nth-child(3)  { animation-delay:.12s !important }
    table .table__row:nth-child(4)  { animation-delay:.16s !important }
    table .table__row:nth-child(5)  { animation-delay:.20s !important }
    table .table__row:nth-child(6)  { animation-delay:.24s !important }
    table .table__row:nth-child(7)  { animation-delay:.28s !important }
    table .table__row:nth-child(8)  { animation-delay:.32s !important }
    table .table__row:nth-child(9)  { animation-delay:.36s !important }
    table .table__row:nth-child(10) { animation-delay:.40s !important }
    table .table__row:nth-child(11) { animation-delay:.44s !important }
    table .table__row:nth-child(12) { animation-delay:.48s !important }
    table .table__row:nth-child(13) { animation-delay:.52s !important }
    table .table__row:nth-child(14) { animation-delay:.56s !important }
    table .table__row:nth-child(15) { animation-delay:.60s !important }

    .zm-table-wrap table.table .table__cell {
        padding: 12px 14px !important;
        color: var(--txt-hi) !important;
        vertical-align: middle !important;
        text-align: center !important;
    }

    /* ═════════════════════════════════════════
       ЯЧЕЙКИ — РАЗЛИЧИМОСТЬ ПО ТИПУ ДАННЫХ
       (универсально для всех таблиц SPOT)
    ═════════════════════════════════════════ */

    /* Названия / ссылки на продажу/клиента */
    .zm-table-wrap .table__cell.name,
    .zm-table-wrap .table__cell.sale_name,
    .zm-table-wrap .table__cell.client_name {
        text-align: left !important;
        font-weight: 500 !important;
        max-width: 360px !important;
        color: var(--txt-hi) !important;
    }

    /* Деньги — главный акцент */
    .zm-table-wrap .table__cell.price,
    .zm-table-wrap .table__cell.sum,
    .zm-table-wrap .table__cell.total_sum,
    .zm-table-wrap .table__cell.total_sale_sum {
        font-weight: 700 !important;
        color: var(--acc) !important;
        text-align: right !important;
        font-variant-numeric: tabular-nums !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-size: 13px !important;
        white-space: nowrap !important;
    }

    /* Сумма скидки — приглушённая */
    .zm-table-wrap .table__cell.discount_sum {
        color: var(--bad) !important;
        font-weight: 600 !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-variant-numeric: tabular-nums !important;
        text-align: right !important;
        white-space: nowrap !important;
    }

    /* Процент скидки */
    .zm-table-wrap .table__cell.percent {
        color: var(--warn) !important;
        font-weight: 700 !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-variant-numeric: tabular-nums !important;
    }

    /* Количество */
    .zm-table-wrap .table__cell.count {
        font-weight: 700 !important;
        color: var(--txt-hi) !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-variant-numeric: tabular-nums !important;
        font-size: 13px !important;
    }

    /* Бонусы — фиолетовый */
    .zm-table-wrap .table__cell.paid_bonus,
    .zm-table-wrap .table__cell.received_bonus {
        color: var(--pur) !important;
        font-weight: 600 !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-variant-numeric: tabular-nums !important;
        white-space: nowrap !important;
    }

    /* Пробег — зелёный */
    .zm-table-wrap .table__cell.mileage {
        color: var(--ok) !important;
        font-weight: 600 !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-variant-numeric: tabular-nums !important;
    }
    .zm-table-wrap .table__cell.mileage:not(:empty)::after {
        content: ' км';
        opacity: 0.6;
        font-size: 10px;
        margin-left: 2px;
    }

    /* Гос. номер авто */
    .zm-table-wrap .table__cell.vehicle_number {
        font-family: 'JetBrains Mono', monospace !important;
        font-weight: 800 !important;
        letter-spacing: 0.05em !important;
        color: var(--acc-hi) !important;
        text-transform: uppercase !important;
        white-space: nowrap !important;
    }

    /* ID — приглушённый */
    .zm-table-wrap .table__cell.id {
        font-family: 'JetBrains Mono', monospace !important;
        color: var(--txt-lo) !important;
        font-size: 11px !important;
        font-weight: 500 !important;
    }

    /* Телефон */
    .zm-table-wrap .table__cell.client_phone {
        font-family: 'JetBrains Mono', monospace !important;
        color: var(--txt-mid) !important;
        letter-spacing: 0.02em !important;
        white-space: nowrap !important;
    }

    /* Даты */
    .zm-table-wrap .table__cell.date_create,
    .zm-table-wrap .table__cell.closed_at {
        font-family: 'JetBrains Mono', monospace !important;
        font-size: 11px !important;
        color: var(--txt-mid) !important;
        white-space: nowrap !important;
        line-height: 1.4 !important;
    }

    /* Магазин/станция — приглушённый */
    .zm-table-wrap .table__cell.station_name {
        color: var(--txt-mid) !important;
        font-size: 12px !important;
    }

    /* Продавец/мастер */
    .zm-table-wrap .table__cell.seller {
        color: var(--txt-mid) !important;
        font-size: 12px !important;
        text-align: left !important;
    }

    /* Тип оплаты — иконка по центру */
    .zm-table-wrap .table__cell.type_payment img {
        display: inline-block !important;
        max-width: 22px !important;
        max-height: 22px !important;
        opacity: 0.9 !important;
    }

    /* Комментарии — мягкий, курсивом */
    .zm-table-wrap .table__cell.comment,
    .zm-table-wrap .table__cell.call_center_comment,
    .zm-table-wrap .table__cell.security_service_comment {
        color: var(--txt-mid) !important;
        font-size: 12px !important;
        font-style: italic !important;
        max-width: 220px !important;
        text-align: left !important;
        line-height: 1.4 !important;
    }

    /* Маленький суффикс копеек */
    .zm-table-wrap .table__cell small {
        font-size: 9px !important;
        color: var(--txt-lo) !important;
        vertical-align: super !important;
        margin-left: 1px !important;
    }
    .tableNHeader { background: transparent !important; }

    /* Тонкий разделитель между группами столбцов в чеке */
    .zm-table-wrap table#sales_items .table__cell.total_sum {
        border-left: 1px solid var(--gl-bord) !important;
    }

    /* ── ИНПУТЫ ─────────────────────────────── */
    input[type="text"],
    input[type="number"],
    input[type="search"],
    textarea,
    select {
        background: var(--gl-2) !important;
        border: 1px solid var(--gl-bord) !important;
        border-radius: var(--r-md) !important;
        color: var(--txt-hi) !important;
        padding: 10px 14px !important;
        font-size: 13px !important;
        font-family: inherit !important;
        transition: all .2s cubic-bezier(.4,0,.2,1) !important;
        outline: none !important;
        width: 100% !important;
        appearance: none !important;
        -webkit-appearance: none !important;
    }
    input:focus, select:focus, textarea:focus {
        background: var(--gl-3) !important;
        border-color: var(--acc) !important;
        box-shadow: 0 0 0 3px var(--acc-soft) !important;
    }
    input::placeholder { color: var(--txt-lo) !important; opacity: 1 !important; }

    select {
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237dd3fc' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") !important;
        background-repeat: no-repeat !important;
        background-position: right 12px center !important;
        background-size: 12px !important;
        padding-right: 32px !important;
    }
    select.multiple, select[multiple] {
        background-image: none !important;
        padding: 6px !important;
        height: auto !important;
        min-height: 200px !important;
    }
    select.multiple option, select[multiple] option {
        padding: 6px 10px !important;
        border-radius: var(--r-sm) !important;
        margin: 1px 0 !important;
        color: var(--txt-hi) !important;
        background: transparent !important;
    }
    select.multiple option:checked, select[multiple] option:checked {
        background: var(--acc) !important;
        color: var(--bg-deep) !important;
    }

    table input[type="checkbox"],
    input[type="checkbox"] {
        accent-color: var(--acc) !important;
        width: 16px !important;
        height: 16px !important;
        cursor: pointer !important;
        background: var(--gl-2) !important;
        border: 1px solid var(--gl-bord-hi) !important;
        border-radius: 4px !important;
    }

    /* ── КНОПКИ ─────────────────────────────── */
    /* Базовые стили для всех кнопок CRM */
    input[type="submit"], input[type="button"], button:not(.zm-theme-toggle):not(.zm-user-logout):not(.zm-nav-group-head):not(.zm-nav-item):not(.zm-panel-header):not(.spoiler button) {
        background: linear-gradient(135deg, var(--acc) 0%, var(--acc-hi) 100%) !important;
        color: var(--bg-deep) !important;
        border: none !important;
        border-radius: var(--r-md) !important;
        padding: 10px 22px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        font-family: inherit !important;
        cursor: pointer !important;
        box-shadow: 0 4px 14px var(--acc-glow), 0 0 0 1px rgba(125, 211, 252, 0.15) !important;
        transition: all .25s cubic-bezier(.4,0,.2,1) !important;
        letter-spacing: 0.01em !important;
        position: relative !important;
        overflow: hidden !important;
    }
    /* Эффект блика — ТОЛЬКО на главных submit-кнопках */
    input[type="submit"]::before, .submit-filter::before, .zm-search-btn::before {
        content: '';
        position: absolute;
        top: 0; left: -100%;
        width: 100%; height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
        transition: left .5s;
        pointer-events: none;
    }
    input[type="submit"]:hover::before, .submit-filter:hover::before, .zm-search-btn:hover::before {
        left: 100%;
    }
    input[type="submit"]:hover, input[type="button"]:hover, button:not(.zm-theme-toggle):not(.zm-user-logout):not(.zm-nav-group-head):not(.zm-nav-item):not(.zm-panel-header):not(.spoiler button):hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 8px 24px var(--acc-glow), 0 0 0 1px rgba(125, 211, 252, 0.3) !important;
        filter: brightness(1.05) !important;
    }
    input[type="submit"]:active, input[type="button"]:active, button:active {
        transform: translateY(0) !important;
    }

    .submit-filter {
        width: 100% !important;
        padding: 12px 22px !important;
    }

    /* ── SEARCH WITH BUTTON ──────────────── */
    .zm-search-wrap {
        display: flex !important;
        gap: 8px !important;
        align-items: stretch !important;
    }
    .zm-search-wrap input[type="text"] { flex: 1 !important; }
    .zm-search-btn {
        flex-shrink: 0 !important;
        width: 44px !important;
        padding: 0 !important;
        display: grid !important;
        place-items: center !important;
    }
    .zm-search-btn svg {
        width: 18px; height: 18px;
        stroke: var(--bg-deep);
        stroke-width: 2.5;
    }

    /* ── FORM LINES ──────────────────────── */
    .form__line {
        margin: 12px 0 !important;
    }
    .form__label {
        font-size: 11px !important;
        color: var(--txt-mid) !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.06em !important;
        display: block !important;
        margin-bottom: 6px !important;
    }

    /* ── ССЫЛКИ ───────────────────────────── */
    a { color: var(--acc) !important; text-decoration: none !important; transition: color .2s !important; }
    a:hover { color: var(--acc-hi) !important; }

    /* ── СКРОЛЛБАР — СКРЫТЬ ─────────────────── */
/* Chrome, Safari, Edge (WebKit) */
::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
    display: none !important;
    background: transparent !important;
}
::-webkit-scrollbar-track,
::-webkit-scrollbar-thumb,
::-webkit-scrollbar-corner {
    display: none !important;
    background: transparent !important;
}

/* Firefox */
* {
    scrollbar-width: none !important;
    -ms-overflow-style: none !important;
}

/* IE 10+ */
html, body, .zm-sidebar, .zm-panel-body, .zm-table-wrap table.table {
    -ms-overflow-style: none !important;
    scrollbar-width: none !important;
}

    /* ── КНОПКА КОПИРОВАНИЯ АРТИКУЛА ────────── */
    .zm-art-btn {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        margin-left: 10px !important;
        padding: 3px 8px !important;
        background: var(--acc-soft) !important;
        color: var(--acc) !important;
        border: 1px solid var(--gl-bord-hi) !important;
        border-radius: var(--r-sm) !important;
        font-size: 11px !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        transition: all .2s cubic-bezier(.4,0,.2,1) !important;
        box-shadow: none !important;
        text-transform: none !important;
        letter-spacing: 0 !important;
        line-height: 1.2 !important;
        vertical-align: middle !important;
        white-space: nowrap !important;
    }
    .zm-art-btn::before { display: none !important; content: none !important; }
    .zm-art-btn svg {
        width: 12px !important;
        height: 12px !important;
        flex-shrink: 0 !important;
    }
    .zm-art-btn:hover {
        background: var(--acc) !important;
        color: var(--bg-deep) !important;
        border-color: var(--acc) !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 4px 10px var(--acc-glow) !important;
        filter: none !important;
    }
    .zm-art-btn.is-copied {
        background: var(--ok) !important;
        color: var(--bg-deep) !important;
        border-color: var(--ok) !important;
        transform: none !important;
    }
    .zm-art-btn.is-copied .zm-art-btn-icon { display: none !important; }
    .zm-art-btn.is-copied::after {
        content: '✓ скопировано';
        margin-left: 2px;
    }
    .zm-art-btn.is-copied .zm-art-btn-code { display: none !important; }

    /* ── СПОЙЛЕР (Описание раздела) ───────── */
    .spoiler {
        margin: 14px 0 !important;
    }
    .spoiler button {
        background: var(--gl-2) !important;
        border: 1px solid var(--gl-bord) !important;
        color: var(--txt-mid) !important;
        padding: 6px 14px !important;
        border-radius: var(--r-sm) !important;
        font-size: 12px !important;
        cursor: pointer !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        box-shadow: none !important;
        font-family: inherit !important;
        transition: all .2s !important;
    }
    .spoiler button::before { display: none !important; }
    .spoiler button:hover {
        background: var(--gl-3) !important;
        color: var(--acc) !important;
        border-color: var(--gl-bord-hi) !important;
        transform: none !important;
        box-shadow: none !important;
    }
    .spoiler p {
        background: var(--gl-2) !important;
        border-left: 3px solid var(--acc) !important;
        border-radius: var(--r-md) !important;
        padding: 12px 14px !important;
        font-size: 13px !important;
        color: var(--txt-mid) !important;
        margin-top: 8px !important;
    }

    /* ── МОДАЛКИ ──────────────────────────── */
    .modal { background: rgba(10, 14, 26, 0.6) !important; backdrop-filter: blur(8px) !important; }
    .modal-data, .modal-content {
        background: var(--gl-3) !important;
        backdrop-filter: blur(28px) !important;
        border: 1px solid var(--gl-bord-hi) !important;
        border-radius: var(--r-xl) !important;
        color: var(--txt-hi) !important;
    }

    /* ── АНИМАЦИИ ─────────────────────────── */
    @keyframes zmFadeR { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:none} }
    @keyframes zmFadeU { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:none} }
    @keyframes zmRowIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:none} }

`).appendTo('head');


/* ─────────────────────────────────────────────
   PARTICLES CANVAS — точки тянутся к курсору
───────────────────────────────────────────── */
function initParticles() {
    var canvas = document.createElement('canvas');
    canvas.id = 'zm-particles';
    document.body.appendChild(canvas);

    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return; // canvas недоступен — пропускаем фон, не ломаем остальной shell
    var w, h;
    var mouse = { x: -9999, y: -9999 };
    var particles = [];
    var PARTICLE_COUNT = 110;
    var MAX_LINK_DIST = 150;
    var MOUSE_RADIUS = 200;

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }

    function getAccentColor() {
        // Берём текущий цвет акцента из CSS (зависит от темы)
        var c = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
        return c || '#7dd3fc';
    }

    function createParticles() {
        particles = [];
        for (var i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                r: Math.random() * 1.6 + 0.6
            });
        }
    }

    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
        var n = parseInt(hex, 16);
        return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
    }

    function loop() {
        ctx.clearRect(0, 0, w, h);

        var col = getAccentColor();
        var rgb;
        if (col.startsWith('#')) {
            rgb = hexToRgb(col);
        } else {
            var m = col.match(/\d+/g);
            rgb = m ? { r: +m[0], g: +m[1], b: +m[2] } : { r: 125, g: 211, b: 252 };
        }
        var rgbStr = rgb.r + ',' + rgb.g + ',' + rgb.b;

        // На светлой теме треугольники тёмные, на тёмной — белые
        var isLight = document.body.classList.contains('zm-theme-light');
        var triRgb = isLight ? '15, 23, 42' : '255, 255, 255';

        var N = particles.length;
        var MAX2 = MAX_LINK_DIST * MAX_LINK_DIST;

        // 1) Двигаем все частицы
        for (var i = 0; i < N; i++) {
            var p = particles[i];
            var dxm = mouse.x - p.x, dym = mouse.y - p.y;
            var dm = Math.sqrt(dxm*dxm + dym*dym);
            if (dm < MOUSE_RADIUS && dm > 0) {
                var pull = (MOUSE_RADIUS - dm) / MOUSE_RADIUS * 0.2;
                p.vx += (dxm/dm) * pull * 0.005;
                p.vy += (dym/dm) * pull * 0.005;
            }
            p.vx *= 0.985;
            p.vy *= 0.985;
            if (Math.abs(p.vx) < 0.05) p.vx += (Math.random() - 0.5) * 0.05;
            if (Math.abs(p.vy) < 0.05) p.vy += (Math.random() - 0.5) * 0.05;
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0) { p.x = 0; p.vx *= -1; }
            if (p.x > w) { p.x = w; p.vx *= -1; }
            if (p.y < 0) { p.y = 0; p.vy *= -1; }
            if (p.y > h) { p.y = h; p.vy *= -1; }
        }

        // 2) Строим список соседей (для быстрого детекта треугольников)
        var nbrs = new Array(N);
        for (var i = 0; i < N; i++) nbrs[i] = [];
        for (var i = 0; i < N; i++) {
            for (var j = i + 1; j < N; j++) {
                var p1 = particles[i], p2 = particles[j];
                var dx = p1.x - p2.x, dy = p1.y - p2.y;
                var d2 = dx*dx + dy*dy;
                if (d2 < MAX2) {
                    var d = Math.sqrt(d2);
                    nbrs[i].push({ idx: j, d: d });
                    nbrs[j].push({ idx: i, d: d });
                }
            }
        }

        function distBetween(a, b) {
            var arr = nbrs[a];
            for (var k = 0; k < arr.length; k++) if (arr[k].idx === b) return arr[k].d;
            return -1;
        }

        // 3) ТРЕУГОЛЬНИКИ — рисуем под линиями.
        //    Чем больше треугольник, тем менее закрашен (квадратичный спад).
        for (var i = 0; i < N; i++) {
            var nb = nbrs[i];
            for (var a = 0; a < nb.length; a++) {
                var j = nb[a].idx;
                if (j <= i) continue;
                for (var b = a + 1; b < nb.length; b++) {
                    var k = nb[b].idx;
                    if (k <= i) continue;
                    var djk = distBetween(j, k);
                    if (djk < 0) continue;
                    var maxSide = nb[a].d;
                    if (nb[b].d > maxSide) maxSide = nb[b].d;
                    if (djk > maxSide)     maxSide = djk;
                    var size = maxSide / MAX_LINK_DIST;            // 0..1
                    var alpha = (1 - size) * (1 - size) * 0.18;     // меньше → плотнее
                    if (alpha < 0.004) continue;
                    var pi = particles[i], pj = particles[j], pk = particles[k];
                    ctx.beginPath();
                    ctx.moveTo(pi.x, pi.y);
                    ctx.lineTo(pj.x, pj.y);
                    ctx.lineTo(pk.x, pk.y);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(' + triRgb + ',' + alpha + ')';
                    ctx.fill();
                }
            }
        }

        // 4) Линии между соседями
        for (var i = 0; i < N; i++) {
            var nb = nbrs[i];
            for (var a = 0; a < nb.length; a++) {
                var j = nb[a].idx;
                if (j <= i) continue;
                var d = nb[a].d;
                var alpha = (1 - d / MAX_LINK_DIST) * 0.45;
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                ctx.strokeStyle = 'rgba(' + rgbStr + ',' + alpha + ')';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            // Линия к курсору
            var dx = particles[i].x - mouse.x;
            var dy = particles[i].y - mouse.y;
            var d = Math.sqrt(dx*dx + dy*dy);
            if (d < MOUSE_RADIUS) {
                var alpha2 = (1 - d / MOUSE_RADIUS) * 0.7;
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(mouse.x, mouse.y);
                ctx.strokeStyle = 'rgba(' + rgbStr + ',' + alpha2 + ')';
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        }

        // 5) Сами точки — поверх всего
        for (var i = 0; i < N; i++) {
            var p = particles[i];
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + rgbStr + ',0.9)';
            ctx.fill();
        }

        requestAnimationFrame(loop);
    }

    window.addEventListener('resize', function() { resize(); createParticles(); });
    window.addEventListener('mousemove', function(e) { mouse.x = e.clientX; mouse.y = e.clientY; });
    window.addEventListener('mouseleave', function() { mouse.x = -9999; mouse.y = -9999; });

    resize();
    createParticles();
    loop();
}


/* ─────────────────────────────────────────────
   BUILD APP SHELL
───────────────────────────────────────────── */
function buildShell() {
    if ($('.zm-app').length) return; // уже построено

    // Берём данные пользователя из дефолтной шапки
    var userName = $('.name_info').text().trim() || 'Пользователь';
    var userStation = $('.address').clone().children('img').remove().end().text().trim() || '';
    var userAvatar = $('.profile_picture img').attr('src') || '';
    var fallbackTitleMap = {
        analyse:       'Наличие товара',
        dial_clients:  'Обзвон клиентов',
        client_sales:  'Продажи клиента',
        sale:          'Продажа',
    };
    var pageTitle = $('.page_header h1').text().trim() || fallbackTitleMap[pageType] || 'SPOT CRM';

    // Извлекаем название станции из заголовка (если есть)
    var stationOnly = '';
    var titleMain = pageTitle;
    var m = pageTitle.match(/^(Наличие\s+товара)\s+(.+)$/i);
    if (m) {
        titleMain = m[1];
        stationOnly = m[2];
    }

    // Берём ссылки навигации из дефолтной шапки + подменю
    var navItems = [];
    $('body > .page > .header .top_menu .menu-item').each(function() {
        var $li = $(this);
        var $a = $li.children('a').first();
        var text = $a.text().trim();
        if (!text) return;
        var href = $a.attr('href') || null;
        var iconUrl = $a.find('img').attr('src') || '';

        // Собираем подпункты
        var children = [];
        $li.find('.child_menu > li > a').each(function() {
            var $sub = $(this);
            children.push({
                text: $sub.text().trim(),
                href: $sub.attr('href') || '#',
                active: ($sub.attr('href') || '').indexOf('/analyse/free') === 0,
            });
        });

        var hasActiveChild = children.some(function(c) { return c.active; });
        navItems.push({
            text: text,
            href: href,
            icon: iconUrl,
            children: children,
            active: hasActiveChild,
        });
    });

    // Создаём кастомный shell
    var $app = $('<div class="zm-app"></div>');

    // ── SIDEBAR ──
    var $sb = $('<aside class="zm-sidebar"></aside>');

    var $logo = $(
        '<div class="zm-logo">' +
            '<div class="zm-logo-mark">S</div>' +
            '<div class="zm-logo-txt">' +
                '<div class="zm-logo-txt-1">SPOT</div>' +
                '<div class="zm-logo-txt-2">CRM</div>' +
            '</div>' +
        '</div>'
    );
    $sb.append($logo);

    var $nav = $('<nav class="zm-nav"></nav>');
    $nav.append('<div class="zm-nav-section">Меню</div>');

    // SVG иконки (Lucide-style stroked)
    var svgIcons = {
        home:    '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        chart:   '<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        users:   '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        store:   '<svg viewBox="0 0 24 24"><path d="M3 9l1-5h16l1 5"/><path d="M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9 21V12h6v9"/></svg>',
        logout:  '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
        chev:    '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>',
        dot:     '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
        circle:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>',
    };

    var iconKeyMap = {
        'главная':  'home',
        'анализ':   'chart',
        'клиенты':  'users',
        'станции':  'store',
        'выход':    'logout',
    };

    function pickIcon(text) {
        var key = (text || '').toLowerCase();
        for (var k in iconKeyMap) {
            if (key.indexOf(k) !== -1) return iconKeyMap[k];
        }
        return 'circle';
    }

    navItems.forEach(function(item) {
        var iconKey = pickIcon(item.text);
        var hasChildren = item.children && item.children.length > 0;

        if (hasChildren) {
            // Группа с подменю
            var $group = $('<div class="zm-nav-group"></div>')
                .toggleClass('is-open', item.active);

            var $head = $('<div class="zm-nav-item zm-nav-group-head"></div>')
                .toggleClass('is-active', item.active);
            $head.append('<span class="zm-nav-item-icon">' + svgIcons[iconKey] + '</span>');
            $head.append('<span class="zm-nav-item-label">' + item.text + '</span>');
            $head.append('<span class="zm-nav-chev">' + svgIcons.chev + '</span>');
            $group.append($head);

            var $sub = $('<div class="zm-nav-sub"></div>');
            item.children.forEach(function(c) {
                var $a = $('<a class="zm-nav-item zm-nav-sub-item"></a>')
                    .attr('href', c.href)
                    .toggleClass('is-active', c.active);
                $a.append('<span class="zm-nav-item-icon">' + (c.active ? svgIcons.dot : svgIcons.circle) + '</span>');
                $a.append('<span class="zm-nav-item-label">' + c.text + '</span>');
                $sub.append($a);
            });
            $group.append($sub);

            $head.on('click', function(e) {
                e.preventDefault();
                $group.toggleClass('is-open');
            });

            $nav.append($group);
        } else {
            // Простая ссылка
            var $a = $('<a class="zm-nav-item"></a>')
                .attr('href', item.href || '#')
                .toggleClass('is-active', item.active);
            $a.append('<span class="zm-nav-item-icon">' + svgIcons[iconKey] + '</span>');
            $a.append('<span class="zm-nav-item-label">' + item.text + '</span>');
            $nav.append($a);
        }
    });

    $sb.append($nav);
    $sb.append('<div class="zm-sidebar-spacer"></div>');

    // User card
    var $uc = $('<div class="zm-user-card"></div>');
    if (userAvatar) {
        $uc.append('<img class="zm-user-avatar" src="' + userAvatar + '" alt=""/>');
    }
    $uc.append(
        '<div class="zm-user-info">' +
            '<div class="zm-user-name">' + userName + '</div>' +
            '<div class="zm-user-station">' + userStation + '</div>' +
        '</div>' +
        '<button class="zm-user-logout" title="Выход">' +
            '<svg viewBox="0 0 24 24" fill="none"><path d="M18 8l4 4-4 4M22 12H10M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>'
    );
    $sb.append($uc);
    $uc.find('.zm-user-logout').on('click', function() {
        window.location = '/logout';
    });

    $app.append($sb);

    // ── MAIN ──
    var $main = $('<main class="zm-main"></main>');

    // TOPBAR
    var $top = $('<div class="zm-topbar"></div>');
    $top.append('<h1 class="zm-page-title">' + titleMain + (stationOnly ? '<span class="zm-page-station">' + stationOnly + '</span>' : '') + '</h1>');
    $top.append('<div class="zm-topbar-spacer"></div>');
    $top.append('<button class="zm-theme-toggle" title="Сменить тему"><svg viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>');
    $main.append($top);

    // CONTENT
    var $content = $('<div class="zm-content"></div>');
    $content.append('<div id="zm-panel-filters"></div>');
    $content.append('<div id="zm-table-host"></div>');
    $main.append($content);

    $app.append($main);

    // Заменяем оригинальный body структурой
    // Чтобы не сломать систему — добавляем .zm-app перед .page и скрываем .page.content + header
    $('body > .page').css('display', 'none');
    $('body').prepend($app);
}


/* ─────────────────────────────────────────────
   ПЕРЕНОС ОРИГИНАЛЬНОЙ ТАБЛИЦЫ И ФИЛЬТРОВ В НАШ SHELL
───────────────────────────────────────────── */
function makePanel(icon, title, meta, $contents, isOpen) {
    if (!$contents || !$contents.length) return null;
    var $panel = $(
        '<section class="zm-panel">' +
            '<div class="zm-panel-header">' +
                '<div class="zm-panel-icon">' + icon + '</div>' +
                '<div class="zm-panel-title">' + title + '</div>' +
                (meta ? '<div class="zm-panel-meta">' + meta + '</div>' : '') +
                '<div class="zm-panel-chev">▾</div>' +
            '</div>' +
            '<div class="zm-panel-body"></div>' +
        '</section>'
    );
    $panel.find('.zm-panel-body').append($contents);
    if (isOpen) $panel.addClass('is-open');
    $panel.find('.zm-panel-header').on('click', function() {
        $panel.toggleClass('is-open');
    });
    return $panel;
}

function makeTableBlock(title, $tableForm, rowSelector) {
    var $wrap = $('<div class="zm-table-wrap"></div>');
    var $hdr = $('<div class="zm-table-header"></div>');
    $hdr.append('<div class="zm-table-header-title">' + title + '</div>');
    var rowCount = $tableForm.find(rowSelector || 'tbody tr.table__row, > tr.table__row, .table tr.table__row').length;
    if (rowCount) $hdr.append('<div class="zm-table-header-count">' + rowCount + ' позиций</div>');
    $wrap.append($hdr);
    $wrap.append($tableForm);
    return $wrap;
}

function moveContent() {
    var $filtersHost = $('#zm-panel-filters');
    var $tableHost   = $('#zm-table-host');
    if (!$filtersHost.length || !$tableHost.length) return;
    if ($tableHost.children().length) return; // уже переносили

    if (pageType === 'analyse') {
        // === НАЛИЧИЕ ТОВАРА ===
        var $form = $('body > .page .left-container > form.form').first();
        var stationsCount = $form.find('option[selected]').length;
        var $panel = makePanel('⚙', 'Фильтры',
            stationsCount ? stationsCount + ' станций' : 'станции',
            $form, false);
        if ($panel) $filtersHost.append($panel);

        var $tableBlock = $('body > .page form.form__extended-table.free');
        if (!$tableBlock.length) $tableBlock = $('table#free').closest('.table_wrapper');
        if ($tableBlock.length) {
            $tableHost.append(makeTableBlock('Остатки на складе', $tableBlock));
        }

    } else if (pageType === 'dial_clients') {
        // === ОБЗВОН КЛИЕНТОВ — фильтр по дате + поиск клиента ===
        // Поисковая форма иногда обёрнута в <div>, поэтому ищем по descendant
        var $allForms = $('body > .page .left-container form.form');
        var $filterForm = $allForms.filter(function() {
            return $(this).find('.datepicker-here, input[name="date"]').length > 0
                && $(this).find('input[name="phone"], input[name="vehicleNumber"]').length === 0;
        }).first();
        if (!$filterForm.length) $filterForm = $allForms.eq(0);
        var $searchForm = $allForms.filter(function() {
            return $(this).find('input[name="phone"], input[name="vehicleNumber"]').length > 0;
        }).first();

        if ($filterForm.length) {
            var $p1 = makePanel('⚙', 'Фильтры', null, $filterForm, true);
            if ($p1) $filtersHost.append($p1);
        }
        if ($searchForm.length) {
            var $p2 = makePanel('🔍', 'Поиск клиента', 'телефон / номер авто', $searchForm, true);
            if ($p2) $filtersHost.append($p2);
        }

        var $tbl = $('body > .page form.form__extended-table.dial_clients');
        if (!$tbl.length) $tbl = $('table#dial_clients').closest('.table_wrapper');
        if ($tbl.length) {
            $tableHost.append(makeTableBlock('Список продаж', $tbl));
        }

    } else if (pageType === 'client_sales') {
        // === ПРОДАЖИ КЛИЕНТА — поиск + блок информации ===
        var $searchForm = $('body > .page .left-container > form').filter(function() {
            return $(this).find('input[name="q"]').length > 0;
        }).first();
        if ($searchForm.length) {
            var $p = makePanel('🔍', 'Поиск', null, $searchForm, true);
            if ($p) $filtersHost.append($p);
        }

        // Информация о клиенте — всё что осталось в .left-container (кроме форм /edit, sms и дубля заголовка "Поиск")
        var $info = $('<div class="zm-client-info"></div>');
        $('body > .page .left-container').children().each(function() {
            var $el = $(this);
            if ($el.is('form[action="/edit"], form.sms-send-form, script, style')) return;
            if ($el.is('h3') && /^\s*поиск\s*$/i.test($el.text())) return;
            $info.append($el);
        });
        if ($info.children().length) {
            var $pi = makePanel('ℹ', 'Информация о клиенте', null, $info, true);
            if ($pi) $filtersHost.append($pi);
        }

        var $tbl2 = $('body > .page form.form__extended-table.clients');
        if (!$tbl2.length) $tbl2 = $('table#clients').closest('.table_wrapper');
        if ($tbl2.length) {
            $tableHost.append(makeTableBlock('Чеки клиента', $tbl2));
        }

    } else if (pageType === 'sale') {
        // === ЧЕК УСЛУГИ — слева вся инфа о продаже/клиенте ===
        var $info2 = $('<div class="zm-sale-info"></div>');
        $('body > .page .left-container').children().each(function() {
            var $el = $(this);
            if ($el.is('form[action="/edit"], form.sms-send-form, script, style')) return;
            $info2.append($el);
        });
        if ($info2.children().length) {
            var $pi2 = makePanel('ℹ', 'Информация о продаже', null, $info2, true);
            if ($pi2) $filtersHost.append($pi2);
        }

        var $tbl3 = $('body > .page form.form__extended-table.sales_items');
        if (!$tbl3.length) $tbl3 = $('table#sales_items').closest('.table_wrapper');
        if ($tbl3.length) {
            $tableHost.append(makeTableBlock('Состав чека', $tbl3));
        }

    } else {
        // Fallback: подхватим любую таблицу .table в body > .page
        var $tblF = $('body > .page form.form__extended-table').first();
        if (!$tblF.length) $tblF = $('body > .page table.table').first().closest('.table_wrapper');
        if ($tblF.length) {
            $tableHost.append(makeTableBlock('Таблица', $tblF));
        }
    }
}


/* ─────────────────────────────────────────────
   КНОПКА ПОИСКА (для /analyse/free)
───────────────────────────────────────────── */
function addSearchButton() {
    var $input = $('#field__withCatalogItems');
    if (!$input.length) return;
    if ($input.parent('.zm-search-wrap').length) return;

    $input.wrap('<div class="zm-search-wrap"></div>');
    var $btn = $(
        '<button type="submit" class="zm-search-btn" title="Найти">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<circle cx="11" cy="11" r="8"></circle>' +
                '<line x1="21" y1="21" x2="16.65" y2="16.65"></line>' +
            '</svg>' +
        '</button>'
    );
    $input.after($btn);
    $btn.on('click', function(e) {
        e.preventDefault();
        $input.closest('form').submit();
    });
}


/* ─────────────────────────────────────────────
   КНОПКА КОПИРОВАНИЯ АРТИКУЛА ФИЛЬТРА (для /sale/*)
   В строках типа "NSIN0017868866 Масляный фильтр LYNX LC-171 LYNXauto"
   копируем артикул производителя — LC-171.
───────────────────────────────────────────── */
function extractFilterArticle(text) {
    if (!text) return null;
    var lower = text.toLowerCase();

    // Должно быть упоминание "фильтр" любого типа
    var idx = lower.indexOf('фильтр');
    if (idx === -1) return null;

    // Подстрока после слова "фильтр" — без подзвезды русских букв
    var after = text.substring(idx + 'фильтр'.length).trim();
    if (!after) return null;
    // Обрезаем по разделителям
    after = after.split(/[,.;|]/)[0].trim();

    var tokens = after.split(/\s+/);

    // 1) LYNX/LIQUI MOLY / MD-... / OC-... / LC-... — буквы-дефис-цифры
    for (var i = 0; i < tokens.length; i++) {
        if (/^[A-Za-z]{1,4}-\d+[A-Za-z\d-]*$/.test(tokens[i])) return tokens[i];
    }
    // 2) MANN-style: "C 22 117", "CU 26 016", "WK 853/4", "AG 234 CF" — буквы + пробел + цифры
    var m2 = after.match(/\b([A-Z]{1,3}K?\s?\d{1,4}(?:[\s\/\-]\d{1,4}){0,2}(?:\s*[A-Za-z]{1,3})?)\b/);
    if (m2) {
        var sku = m2[1].trim().replace(/\s+/g, ' ');
        if (sku.replace(/\s/g, '').length >= 3) return sku;
    }
    // 3) Любой токен с дефисом и цифрой
    for (var i = 0; i < tokens.length; i++) {
        if (/-/.test(tokens[i]) && /\d/.test(tokens[i])) return tokens[i];
    }
    // 4) Любой токен с буквой и цифрой
    for (var i = 0; i < tokens.length; i++) {
        if (/[A-Za-z]/.test(tokens[i]) && /\d/.test(tokens[i])) return tokens[i];
    }
    return null;
}

function buildCopyBtn(article) {
    var $btn = $(
        '<button type="button" class="zm-art-btn" title="Скопировать артикул">' +
            '<span class="zm-art-btn-icon">' +
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
                '</svg>' +
            '</span>' +
            '<span class="zm-art-btn-code"></span>' +
        '</button>'
    );
    $btn.find('.zm-art-btn-code').text(article);
    $btn.on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var ok = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(article);
                ok = true;
            }
        } catch (err) { ok = false; }
        if (!ok) {
            var ta = document.createElement('textarea');
            ta.value = article;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
        }
        $btn.addClass('is-copied');
        setTimeout(function() { $btn.removeClass('is-copied'); }, 1100);
    });
    return $btn;
}

function addFilterArticleButtons() {
    if (pageType !== 'sale') return;
    $('.zm-table-wrap table#sales_items tbody tr.table__row').each(function() {
        var $row = $(this);
        var $name = $row.find('td.table__cell.name').first();
        if (!$name.length) return;
        if ($name.find('.zm-art-btn').length) return;
        // Только полный текст строки названия, без подкладок
        var text = $name.contents().filter(function() {
            return this.nodeType === 3; // текстовые узлы
        }).text().trim();
        if (!text) text = $name.text().trim();
        var article = extractFilterArticle(text);
        if (!article) return;
        $name.append(buildCopyBtn(article));
    });
}


/* ─────────────────────────────────────────────
   THEME TOGGLE
───────────────────────────────────────────── */
function initThemeToggle() {
    var moonSvg = '<svg viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var sunSvg  = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    var saved = localStorage.getItem('zm-crm-theme') || 'dark';
    if (saved === 'light') {
        document.body.classList.add('zm-theme-light');
        $('.zm-theme-toggle').html(sunSvg);
    }

    $(document).on('click', '.zm-theme-toggle', function() {
        var isLight = document.body.classList.toggle('zm-theme-light');
        localStorage.setItem('zm-crm-theme', isLight ? 'light' : 'dark');
        $('.zm-theme-toggle').html(isLight ? sunSvg : moonSvg);
    });
}


/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
function init() {
    initParticles();
    buildShell();
    moveContent();
    addSearchButton();
    addFilterArticleButtons();
    initThemeToggle();

    setTimeout(function() {
        moveContent();
        addSearchButton();
        addFilterArticleButtons();
    }, 400);
    setTimeout(addFilterArticleButtons, 1200);

    console.log('[SPOT CRM] ✨ Liquid Glass v5.1 — multi-page support (' + pageType + ')');
}

if (document.readyState === 'loading') {
    $(document).ready(init);
} else {
    init();
}


})(jQuery);