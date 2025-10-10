// ==UserScript==
// @name         Torn Lingerie Store Tax Tracker (Money + Xanax Support)
// @namespace    https://github.com/ShiftyFurball/Torncity-userscripts
// @version      4.7
// @description  Track weekly company tax (money or items like Xanax) from employees in Torn. Per-member tax type, draggable panel, reminders with custom messages.
// @author       Hooded_Prince (or you)
// @match        https://www.torn.com/*
// @grant        none
// @license      MIT
//
// @homepageURL  https://github.com/ShiftyFurball/Torncity-userscripts
// @supportURL   https://github.com/ShiftyFurball/Torncity-userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/ShiftyFurball/Torncity-userscripts/main/torn-tax-tracker/torn-tax-tracker.user.js
// @updateURL    https://raw.githubusercontent.com/ShiftyFurball/Torncity-userscripts/main/torn-tax-tracker/torn-tax-tracker.user.js
// ==/UserScript==



(function () {
  'use strict';

  const STORAGE_KEY_SETTINGS = "torn_tax_settings_v41";
  const REMINDER_MESSAGE_KEY = "torn_tax_pending_message";
  const REMINDER_TARGET_KEY = "torn_tax_pending_target";
  const REMINDER_TARGET_NAME_KEY = "torn_tax_pending_name";

  const existingStyle = document.getElementById("torn-tax-style");
  if (!existingStyle) {
    const style = document.createElement("style");
    style.id = "torn-tax-style";
    style.textContent = `
      :root {
        color-scheme: dark;
      }

      .torn-tax-open-button {
        position: fixed;
        top: 35%;
        right: 22px;
        z-index: 9999;
        padding: 10px 18px;
        border: none;
        border-radius: 999px;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        font-size: 12px;
        color: #ffffff;
        background: linear-gradient(135deg, #6366f1, #22d3ee);
        box-shadow: 0 12px 24px rgba(34, 211, 238, 0.25);
        cursor: grab;
        transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
      }

      .torn-tax-open-button:hover {
        transform: translateY(-2px) scale(1.02);
        box-shadow: 0 16px 32px rgba(99, 102, 241, 0.35);
        filter: brightness(1.05);
      }

      .torn-tax-open-button:active {
        cursor: grabbing;
      }

      .torn-tax-panel {
        display: none;
        position: fixed;
        top: 10%;
        left: 10%;
        width: 80%;
        height: 75%;
        min-width: 320px;
        background: linear-gradient(145deg, rgba(20, 24, 34, 0.96), rgba(12, 16, 24, 0.96));
        color: #f5f5f5;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        padding: 0;
        z-index: 10000;
        border-radius: 18px;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(14px);
      }

      .torn-tax-panel::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.2), transparent 55%),
                    radial-gradient(circle at 85% 20%, rgba(34, 211, 238, 0.16), transparent 60%);
        opacity: 0.6;
      }

      .torn-tax-panel__content {
        position: relative;
        height: calc(100% - 60px);
        overflow: hidden;
        padding: 0 18px 18px;
      }

      .tax-panel__header {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        background: linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(34, 211, 238, 0.9));
        padding: 14px 18px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.16);
        cursor: move;
      }

      .tax-panel__title {
        font-size: 18px;
        font-weight: 700;
        flex: 1;
        letter-spacing: 0.02em;
      }

      .tax-panel__actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .tax-action-button,
      .tax-button {
        border-radius: 10px;
        border: 1px solid transparent;
        padding: 6px 12px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        background: rgba(255, 255, 255, 0.08);
        color: #f3f4ff;
      }

      .tax-action-button:hover,
      .tax-button:hover {
        transform: translateY(-1px);
        filter: brightness(1.05);
      }

      .tax-action-button:active,
      .tax-button:active {
        transform: translateY(0);
        filter: brightness(0.95);
      }

      .tax-action-button--primary,
      .tax-button--primary {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        box-shadow: 0 8px 20px rgba(99, 102, 241, 0.35);
      }

      .tax-action-button--accent,
      .tax-button--accent {
        background: linear-gradient(135deg, #22d3ee, #0ea5e9);
        box-shadow: 0 8px 18px rgba(34, 211, 238, 0.28);
      }

      .tax-action-button--ghost,
      .tax-button--ghost {
        background: rgba(15, 23, 42, 0.45);
        border-color: rgba(255, 255, 255, 0.12);
      }

      .tax-action-button--danger,
      .tax-button--danger {
        background: linear-gradient(135deg, #f87171, #ef4444);
        box-shadow: 0 8px 18px rgba(239, 68, 68, 0.3);
      }

      .tax-action-button.is-hidden {
        display: none !important;
      }

      .tax-table-wrapper {
        position: relative;
        height: 100%;
        overflow: auto;
        padding-right: 6px;
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.45) transparent;
      }

      .tax-table-wrapper::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      .tax-table-wrapper::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.45);
        border-radius: 999px;
      }

      .tax-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        background: rgba(13, 16, 26, 0.72);
        backdrop-filter: blur(8px);
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      .tax-table thead {
        position: sticky;
        top: 0;
        z-index: 3;
        background: rgba(20, 24, 34, 0.92);
        backdrop-filter: blur(10px);
      }

      .tax-table__header,
      .tax-table__cell {
        padding: 10px 12px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        text-align: center;
      }

      .tax-table__header {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #dbeafe;
        background: rgba(30, 41, 59, 0.8);
      }

      .tax-table__row:nth-child(odd) {
        background: rgba(15, 23, 42, 0.6);
      }

      .tax-table__row:nth-child(even) {
        background: rgba(30, 41, 59, 0.55);
      }

      .tax-table__cell--name {
        text-align: left;
        font-weight: 600;
        color: #f8fafc;
        white-space: nowrap;
      }

      .tax-table__cell--sticky-left {
        position: sticky;
        left: 0;
        background: inherit;
        z-index: 2;
      }

      .tax-table__cell--sticky-right {
        position: sticky;
        right: 0;
        background: inherit;
        z-index: 2;
      }

      .tax-total-cell {
        font-weight: 600;
        white-space: nowrap;
      }

      .tax-total-paid {
        font-weight: 600;
        color: #cbd5f5;
        white-space: nowrap;
      }

      .tax-table tfoot {
        background: rgba(30, 41, 59, 0.82);
      }

      .tax-table__footer {
        padding: 10px 12px;
        font-size: 12px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #e2e8f0;
        border: 1px solid rgba(255, 255, 255, 0.08);
        text-align: center;
      }

      .tax-week {
        font-weight: 600;
        letter-spacing: 0.05em;
        border: none;
      }

      .tax-week--success {
        background: rgba(34, 197, 94, 0.18);
        color: #4ade80;
      }

      .tax-week--danger {
        background: rgba(248, 113, 113, 0.16);
        color: #fca5a5;
      }

      .tax-balance {
        font-weight: 600;
        text-align: center;
      }

      .tax-balance--owing {
        color: #fda4af;
        background: rgba(248, 113, 113, 0.14);
      }

      .tax-balance--overpaid {
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.14);
      }

      .tax-balance--ontime {
        color: #86efac;
        background: rgba(34, 197, 94, 0.12);
      }

      .tax-reminder-card {
        position: relative;
        margin-top: 16px;
        padding: 16px 18px;
        border-radius: 14px;
        background: linear-gradient(145deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.78));
        border: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }

      .tax-reminder-card__title {
        margin: 0 0 10px;
        font-size: 15px;
        font-weight: 700;
        color: #e0f2fe;
      }

      .tax-reminder-card__empty {
        margin: 0;
        color: #a7f3d0;
        font-weight: 500;
      }

      .tax-reminder-card__list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 10px;
      }

      .tax-reminder-card__item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        color: #fecaca;
        background: rgba(239, 68, 68, 0.08);
        border-radius: 10px;
        padding: 12px 14px;
        border: 1px solid rgba(239, 68, 68, 0.18);
        flex-wrap: wrap;
      }

      .tax-reminder-card__details {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .tax-reminder-card__name {
        font-weight: 600;
        color: #fca5a5;
      }

      .tax-reminder-card__amount {
        font-size: 12px;
        color: #fecaca;
        opacity: 0.9;
      }

      .tax-reminder-card__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .tax-reminder-card__message {
        font-size: 12px;
        color: rgba(148, 163, 184, 0.9);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .tax-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(520px, 92vw);
        max-width: calc(100vw - 40px);
        max-height: calc(100vh - 40px);
        min-height: 320px;
        background: linear-gradient(160deg, rgba(15, 23, 42, 0.92), rgba(10, 12, 22, 0.96));
        color: #f8fafc;
        padding: 24px;
        z-index: 11000;
        border-radius: 18px;
        box-shadow: 0 28px 64px rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(18px);
        animation: tax-modal-fade 0.18s ease;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .tax-modal--wide {
        width: min(760px, 94vw);
      }

      .tax-modal--tall {
        min-height: 320px;
      }

      .tax-modal--settings {
        width: min(720px, 94vw);
        max-width: 720px;
        height: auto;
        max-height: calc(100vh - 64px);
      }

      .tax-modal--settings .tax-modal__body {
        flex: 0 1 auto;
        overflow: visible;
        padding-right: 0;
      }

      .tax-modal--requirements {
        width: min(940px, 96vw);
        height: min(680px, 92vh);
      }

      .tax-modal__header {
        border-radius: 14px 14px 0 0;
        margin: -24px -24px 18px;
      }

      .tax-modal__body {
        flex: 1 1 auto;
        overflow: auto;
        margin-bottom: 18px;
        padding-right: 6px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 0;
      }

      .tax-modal__body--flush {
        margin-bottom: 0;
        padding-right: 0;
        gap: 12px;
        overflow: hidden;
      }

      .tax-modal__table-wrapper {
        flex: 1 1 auto;
        overflow: auto;
        border-radius: 12px;
        min-height: 0;
        max-height: 100%;
      }

      .tax-modal h3 {
        margin: 0 0 12px;
        font-size: 20px;
        font-weight: 700;
        color: #c7d2fe;
      }

      .tax-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 14px;
        font-size: 13px;
        color: #cbd5f5;
      }

      .tax-field--checkbox {
        flex-direction: row;
        align-items: center;
        gap: 10px;
        margin-bottom: 0;
      }

      .tax-field--checkbox input[type="checkbox"] {
        width: auto;
        height: 18px;
        min-width: 18px;
        accent-color: #6366f1;
      }

      .tax-settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 14px;
        margin-bottom: 14px;
      }

      .tax-settings-grid--compact {
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      }

      .tax-settings-grid .tax-field,
      .tax-settings-fieldset .tax-field {
        margin-bottom: 0;
      }

      .tax-settings-fieldset {
        border: 1px solid rgba(148, 163, 184, 0.25);
        padding: 16px;
        border-radius: 12px;
        margin: 6px 0 12px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .tax-settings-fieldset legend {
        padding: 0 6px;
        color: #cbd5f5;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .tax-input,
      .tax-textarea,
      .tax-select,
      .tax-modal input[type="number"],
      .tax-modal input[type="text"],
      .tax-modal textarea,
      .tax-modal select {
        width: 100%;
        padding: 9px 12px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(15, 23, 42, 0.65);
        color: #f8fafc;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        font-size: 14px;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }

      .tax-input:focus,
      .tax-textarea:focus,
      .tax-select:focus,
      .tax-modal input[type="number"]:focus,
      .tax-modal input[type="text"]:focus,
      .tax-modal textarea:focus,
      .tax-modal select:focus {
        outline: none;
        border-color: rgba(99, 102, 241, 0.65);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
      }

      .tax-modal small {
        color: rgba(148, 163, 184, 0.75);
      }

      .tax-modal__footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 18px;
      }

      .tax-modal textarea {
        min-height: 90px;
        resize: vertical;
      }

      .tax-toast {
        position: fixed;
        bottom: 32px;
        right: 32px;
        padding: 12px 16px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.92);
        color: #f8fafc;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.45);
        border: 1px solid rgba(148, 163, 184, 0.25);
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        z-index: 12000;
        pointer-events: none;
      }

      .tax-toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .tax-requirements-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
        background: rgba(15, 23, 42, 0.65);
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.2);
      }

      .tax-requirements-table th,
      .tax-requirements-table td {
        border: 1px solid rgba(148, 163, 184, 0.2);
        padding: 10px 12px;
        text-align: left;
        font-size: 13px;
      }

      .tax-requirements-table th {
        background: rgba(30, 41, 59, 0.75);
        color: #e2e8f0;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 12px;
      }

      .tax-requirements-table tbody tr:nth-child(odd) {
        background: rgba(15, 23, 42, 0.65);
      }

      .tax-requirements-table tbody tr:nth-child(even) {
        background: rgba(30, 41, 59, 0.55);
      }

      .tax-requirements-table td:first-child {
        color: #ffffff;
        font-weight: 600;
        white-space: nowrap;
      }

      .tax-modal .tax-select,
      .tax-modal select {
        width: auto;
        min-width: 120px;
      }

      .tax-resize-handle {
        width: 18px;
        height: 18px;
        background: rgba(148, 163, 184, 0.25);
        position: absolute;
        right: 0;
        bottom: 0;
        cursor: se-resize;
        border-top-left-radius: 10px;
        border-bottom-right-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        backdrop-filter: blur(6px);
      }

      @keyframes tax-modal-fade {
        from {
          opacity: 0;
          transform: translate(-50%, -46%);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%);
        }
      }
    `;
    document.head.appendChild(style);
  }

  autoFillReminderMessage();

  const DEFAULT_SETTINGS = {
    startYear: new Date().getUTCFullYear(),
    startWeek: 40,
    maxWeeks: 12,
    manualMode: false,
    manualMembers: {},
    apiKey: "",
    testMode: false,

    // Per-member requirements: { "id": { type: "money"|"xanax", amount: number } }
    memberRequirements: {},

    // Defaults used for NEW members that don't have a requirement set yet:
    defaultMoneyTax: 10000000,
    defaultItemTax: 7,
    taxItemName: "Xanax",

    // Reminder template
    reminderMessage: "Hi {name}, you currently owe {amount}. Please pay as soon as possible. Thanks!"
  };

  function loadSettings() {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
    return saved ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(saved)) : DEFAULT_SETTINGS;
  }
  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(s));
  }

  let SETTINGS = loadSettings();

  // Floating open button
  const button = document.createElement("button");
  button.className = "torn-tax-open-button";
  button.type = "button";
  button.textContent = "Tax";
  document.body.appendChild(button);
  prepareFloatingButton(button);

  // Panel
  const panel = document.createElement("div");
  panel.id = "tax-panel";
  panel.className = "torn-tax-panel";

  panel.innerHTML = `
    <div id="drag-bar" class="tax-panel__header">
      <span class="tax-panel__title">Weekly Tax Tracker</span>
      <div class="tax-panel__actions">
        <button id="editSettings" class="tax-action-button tax-action-button--ghost">Settings</button>
        <button id="editRequirements" class="tax-action-button tax-action-button--accent">Requirements</button>
        <button id="editEmployees" class="tax-action-button tax-action-button--ghost ${SETTINGS.manualMode ? "" : "is-hidden"}">Edit Employees</button>
        <button id="close-tax" class="tax-action-button tax-action-button--danger">Close</button>
      </div>
    </div>
    <div id="taxTable" class="torn-tax-panel__content"></div>
  `;
  document.body.appendChild(panel);

  makeDraggable(panel, panel.querySelector("#drag-bar"));
  makeResizable(panel);

  // Events
  button.addEventListener("click", () => {
    if (!SETTINGS.apiKey && !SETTINGS.testMode) {
      showApiPrompt();
      return;
    }
    panel.style.display = "block";
    fetchData();
  });
  panel.querySelector("#close-tax").addEventListener("click", () => panel.style.display = "none");
  panel.querySelector("#editEmployees").addEventListener("click", () => showEmployeeEditor());
  panel.querySelector("#editSettings").addEventListener("click", () => showSettingsEditor());
  panel.querySelector("#editRequirements").addEventListener("click", () => showRequirementsEditor());

  // --- UI: API key prompt
  function showApiPrompt() {
    const editor = document.createElement("div");
    editor.className = "tax-modal";
    editor.innerHTML = `
      <div class="tax-modal__body">
        <h3>Enter Torn API Key</h3>
        <label class="tax-field">
          <span>Your API Key</span>
          <input id="apiInput" type="text" class="tax-input" value="${SETTINGS.apiKey}">
        </label>
      </div>
      <div class="tax-modal__footer">
        <button id="saveApi" class="tax-button tax-button--primary">Save</button>
      </div>
    `;
    document.body.appendChild(editor);
    editor.querySelector("#saveApi").addEventListener("click", () => {
      SETTINGS.apiKey = editor.querySelector("#apiInput").value.trim();
      saveSettings(SETTINGS);
      editor.remove();
      panel.style.display = "block";
      fetchData();
    });
  }

  // --- UI: Settings
  function showSettingsEditor() {
    const e = document.createElement("div");
    e.className = "tax-modal tax-modal--settings";

    e.innerHTML = `
      <div id="settings-drag-bar" class="tax-panel__header tax-modal__header">
        <span class="tax-panel__title">Settings</span>
      </div>
      <div class="tax-modal__body tax-modal__body--settings">
        <div class="tax-settings-grid">
          <div class="tax-field">
            <label for="setYear">Start Year</label>
            <input id="setYear" type="number" class="tax-input" value="${SETTINGS.startYear}">
          </div>
          <div class="tax-field">
            <label for="setWeek">Start Week</label>
            <input id="setWeek" type="number" class="tax-input" value="${SETTINGS.startWeek}">
          </div>
          <div class="tax-field">
            <label for="setMaxWeeks">Max Weeks to Display</label>
            <input id="setMaxWeeks" type="number" class="tax-input" value="${SETTINGS.maxWeeks}">
          </div>
          <label class="tax-field tax-field--checkbox" for="manualMode">
            <input id="manualMode" type="checkbox" ${SETTINGS.manualMode ? "checked" : ""}>
            <span>Manual Employees Mode</span>
          </label>
          <label class="tax-field tax-field--checkbox" for="testMode">
            <input id="testMode" type="checkbox" ${SETTINGS.testMode ? "checked" : ""}>
            <span>Enable Test Mode (fake data)</span>
          </label>
        </div>

        <fieldset class="tax-settings-fieldset">
          <legend>Defaults for New Members</legend>
          <div class="tax-settings-grid tax-settings-grid--compact">
            <div class="tax-field">
              <label for="setDefaultMoney">Default Money Tax</label>
              <input id="setDefaultMoney" class="tax-input" type="number" value="${SETTINGS.defaultMoneyTax}">
            </div>
            <div class="tax-field">
              <label for="setItemName">Default Item (name)</label>
              <input id="setItemName" class="tax-input" type="text" value="${SETTINGS.taxItemName}">
            </div>
            <div class="tax-field">
              <label for="setDefaultItem">Default Item Tax (qty)</label>
              <input id="setDefaultItem" class="tax-input" type="number" value="${SETTINGS.defaultItemTax}">
            </div>
          </div>
        </fieldset>

        <label class="tax-field">Reminder Message
          <textarea id="setReminder" class="tax-textarea">${SETTINGS.reminderMessage}</textarea>
          <small>Use placeholders: {name}, {id}, {amount}</small>
        </label>
      </div>

      <div class="tax-modal__footer">
        <button id="saveSet" class="tax-button tax-button--primary">Save</button>
        <button id="cancelSet" class="tax-button tax-button--ghost">Cancel</button>
      </div>
    `;
    document.body.appendChild(e);
    setInitialModalSize(e, 720, null);
    makeDraggable(e, e.querySelector("#settings-drag-bar"));
    makeResizable(e);
    e.querySelector("#cancelSet").addEventListener("click", () => e.remove());
    e.querySelector("#saveSet").addEventListener("click", () => {
      SETTINGS.startYear = parseInt(e.querySelector("#setYear").value, 10);
      SETTINGS.startWeek = parseInt(e.querySelector("#setWeek").value, 10);
      SETTINGS.maxWeeks = parseInt(e.querySelector("#setMaxWeeks").value, 10);
      SETTINGS.manualMode = e.querySelector("#manualMode").checked;
      SETTINGS.testMode = e.querySelector("#testMode").checked;
      SETTINGS.defaultMoneyTax = parseInt(e.querySelector("#setDefaultMoney").value, 10);
      SETTINGS.taxItemName = e.querySelector("#setItemName").value.trim() || "Xanax";
      SETTINGS.defaultItemTax = parseInt(e.querySelector("#setDefaultItem").value, 10);
      SETTINGS.reminderMessage = e.querySelector("#setReminder").value.trim();
      saveSettings(SETTINGS);
      e.remove();
      panel.querySelector("#editEmployees").classList.toggle("is-hidden", !SETTINGS.manualMode);
      fetchData();
    });
  }

  // --- UI: Manual employees editor
  function showEmployeeEditor() {
    const editor = document.createElement("div");
    editor.className = "tax-modal tax-modal--wide tax-modal--tall";

    let text = "";
    Object.keys(SETTINGS.manualMembers).forEach(id => {
      const req = SETTINGS.memberRequirements[id] || { type: "money", amount: SETTINGS.defaultMoneyTax };
      text += `${id}:${SETTINGS.manualMembers[id]}:${req.type}:${req.amount}\n`;
    });

    editor.innerHTML = `
      <div class="tax-modal__body">
        <h3>Manual Employees (id:name:type:amount)</h3>
        <textarea id="empInput" class="tax-textarea" style="height:240px;">${text.trim()}</textarea>
        <small>Example: 12345:Alice:money:10000000 OR 67890:Bob:xanax:7</small>
      </div>
      <div class="tax-modal__footer">
        <button id="saveEmp" class="tax-button tax-button--primary">Save</button>
        <button id="cancelEmp" class="tax-button tax-button--ghost">Cancel</button>
      </div>
    `;
    document.body.appendChild(editor);

    editor.querySelector("#cancelEmp").addEventListener("click", () => editor.remove());
    editor.querySelector("#saveEmp").addEventListener("click", () => {
      const lines = editor.querySelector("#empInput").value.split("\n");
      const newList = {};
      const newReqs = {};
      lines.forEach(line => {
        const [id, name, type, amount] = line.split(":").map(x => x.trim());
        if (id && name) {
          newList[id] = name;
          newReqs[id] = { type: (type || "money"), amount: parseInt(amount || SETTINGS.defaultMoneyTax, 10) };
        }
      });
      SETTINGS.manualMembers = newList;
      SETTINGS.memberRequirements = Object.assign({}, SETTINGS.memberRequirements, newReqs);
      saveSettings(SETTINGS);
      editor.remove();
      fetchData();
    });
  }

  // --- UI: Requirements editor (works in API or Manual mode)
  function showRequirementsEditor(currentEmployees = lastEmployeesCache) {
    const editor = document.createElement("div");
    editor.className = "tax-modal tax-modal--wide tax-modal--tall tax-modal--requirements";

    const rows = Object.keys(currentEmployees || {}).sort((a,b)=>currentEmployees[a].localeCompare(currentEmployees[b]))
      .map(id => {
        const req = SETTINGS.memberRequirements[id] || { type: "money", amount: SETTINGS.defaultMoneyTax };
        return `
          <tr>
            <td>${currentEmployees[id]} [${id}]</td>
            <td>
              <select data-id="${id}" class="req-type tax-select">
                <option value="money" ${req.type==="money"?"selected":""}>Money</option>
                <option value="xanax" ${req.type==="xanax"?"selected":""}>${SETTINGS.taxItemName}</option>
              </select>
            </td>
            <td>
              <input type="number" class="req-amount tax-input" data-id="${id}" value="${req.amount}">
            </td>
          </tr>`;
      }).join("");

    editor.innerHTML = `
      <div id="req-drag-bar" class="tax-panel__header tax-modal__header" style="cursor:move;">
        <span class="tax-panel__title" style="font-size:16px;">Member Requirements</span>
      </div>
      <div class="tax-modal__body tax-modal__body--flush">
        <div style="color:#cbd5f5;">Item name shown as "${SETTINGS.taxItemName}" (change in Settings)</div>
        <div class="tax-modal__table-wrapper">
          <table class="tax-requirements-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Type</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rows || "<tr><td colspan='3' style='padding:12px;color:#cbd5f5;'>No employees loaded yet.</td></tr>"}
            </tbody>
          </table>
        </div>
      </div>
      <div class="tax-modal__footer">
        <button id="saveReqs" class="tax-button tax-button--primary">Save</button>
        <button id="cancelReqs" class="tax-button tax-button--ghost">Cancel</button>
      </div>
    `;
    document.body.appendChild(editor);
    setInitialModalSize(editor, 900, 640);

    const dragHandle = editor.querySelector("#req-drag-bar");
    if (dragHandle) {
      makeDraggable(editor, dragHandle);
    }
    makeResizable(editor);

    editor.querySelector("#cancelReqs").addEventListener("click", () => editor.remove());
    editor.querySelector("#saveReqs").addEventListener("click", () => {
      const types = editor.querySelectorAll(".req-type");
      const amounts = editor.querySelectorAll(".req-amount");
      types.forEach(sel => {
        const id = sel.getAttribute("data-id");
        const type = sel.value;
        const amtInput = Array.from(amounts).find(a => a.getAttribute("data-id") === id);
        const amount = parseInt((amtInput && amtInput.value) || (type==="money"?SETTINGS.defaultMoneyTax:SETTINGS.defaultItemTax), 10);
        SETTINGS.memberRequirements[id] = { type, amount };
      });
      saveSettings(SETTINGS);
      editor.remove();
      fetchData();
    });
  }

  // Data caches
  let lastEmployeesCache = {};

  // --- Fetch & build
  async function fetchData() {
    let employees = {};
    let weeklyData = {}; // weekKey -> id -> { money, items }

    if (SETTINGS.testMode) {
      const fake = makeFakeData();
      employees = fake.employees;
      weeklyData = fake.weeklyData;
    } else {
      if (SETTINGS.manualMode) {
        employees = SETTINGS.manualMembers;
      } else {
        const res = await fetch(`https://api.torn.com/company/?selections=employees&key=${encodeURIComponent(SETTINGS.apiKey)}`);
        const data = await res.json();
        employees = {};
        Object.keys(data.company_employees || {}).forEach(id => {
          employees[id] = data.company_employees[id].name;
        });
      }

      // Ensure each known employee has a requirement entry
      Object.keys(employees).forEach(id => {
        if (!SETTINGS.memberRequirements[id]) {
          SETTINGS.memberRequirements[id] = { type: "money", amount: SETTINGS.defaultMoneyTax };
        }
      });
      saveSettings(SETTINGS);
      lastEmployeesCache = employees;

      // Fetch logs: money + items
      const logRes = await fetch(`https://api.torn.com/user/?selections=log&log=4800,4810,4870,4880&key=${encodeURIComponent(SETTINGS.apiKey)}`);
      const logData = await logRes.json();
      const logs = logData.log || {};

      // Build an index of week keys between StartWeek..Today
      const weekKeys = generateWeekKeys(SETTINGS.startYear, SETTINGS.startWeek);
      weekKeys.forEach(wk => weeklyData[wk] = {});

      // Accumulate payments
      for (const lid in logs) {
        const log = logs[lid];
        const ts = new Date(log.timestamp * 1000);
        const [year, week] = getWeekNumber(ts);
        if (year < SETTINGS.startYear || (year === SETTINGS.startYear && week < SETTINGS.startWeek)) continue;
        const wk = `${year}-W${week}`;

        // Who sent?
        const candidateIds = [safe(log, "data.sender"), safe(log, "data.user"), safe(log, "data.initiator")].filter(Boolean);
        const senderId = candidateIds.find(id => employees[id]);
        if (!senderId) continue;

        if (!weeklyData[wk][senderId]) weeklyData[wk][senderId] = { money: 0, items: 0 };

        // Money sent (4810)
        if (log.log === 4810) {
          weeklyData[wk][senderId].money += (safe(log, "data.money") || 0);
          continue;
        }

        // Item sent (4870/4880) - count configured item name
        if (log.log === 4870 || log.log === 4880) {
          const itemName = SETTINGS.taxItemName;

          // Common shapes seen in Torn logs (be generous):
          // 1) data.item = { name, quantity }
          const one = safe(log, "data.item");
          if (one && (one.name === itemName)) {
            weeklyData[wk][senderId].items += (one.quantity || 0);
            continue;
          }
          // 2) data.items = [{ name, quantity }, ...]
          const arr = safe(log, "data.items");
          if (Array.isArray(arr)) {
            arr.forEach(it => {
              if (it && it.name === itemName) weeklyData[wk][senderId].items += (it.quantity || 0);
            });
            continue;
          }
          // 3) data.name / data.qty
          const nm = safe(log, "data.name");
          const qty = safe(log, "data.quantity") || safe(log, "data.qty");
          if (nm === itemName && qty) {
            weeklyData[wk][senderId].items += qty;
          }
        }
      }
    }

    buildTable(weeklyData, employees);
  }

  function buildTable(weeklyData, COMPANY_MEMBERS) {
    const container = document.getElementById("taxTable");

    // Generate consistent week list for expectation
    const allWeekKeys = Object.keys(generateWeekMapFrom(SETTINGS.startYear, SETTINGS.startWeek));
    const displayWeeks = allWeekKeys.slice(-SETTINGS.maxWeeks);

    let html = `<div class=\"tax-table-wrapper\"><table class=\"tax-table\">`;
    html += `<thead><tr>`;
    html += `<th class=\"tax-table__header tax-table__cell--sticky-left\">Employee</th>`;
    displayWeeks.forEach(week => {
      html += `<th class=\"tax-table__header\">${week}</th>`;
    });
    html += `<th class=\"tax-table__header\">Total Paid</th>`;
    html += `<th class=\"tax-table__header tax-table__cell--sticky-right\">Balance</th></tr></thead><tbody>`;

    const owingList = [];
    const totals = {
      money: { paid: 0, balance: 0 },
      items: { paid: 0, balance: 0 }
    };

    Object.keys(COMPANY_MEMBERS).forEach((id, idx) => {
      const req = SETTINGS.memberRequirements[id] || { type: "money", amount: SETTINGS.defaultMoneyTax };
      const rowClass = idx % 2 === 0 ? "tax-table__row tax-table__row--even" : "tax-table__row tax-table__row--odd";
      html += `<tr class=\"${rowClass}\">`;
      html += `<td class=\"tax-table__cell tax-table__cell--name tax-table__cell--sticky-left\">${COMPANY_MEMBERS[id]} [${id}]</td>`;

      let totalPaid = 0;
      displayWeeks.forEach(week => {
        const wk = weeklyData[week] && weeklyData[week][id] ? weeklyData[week][id] : { money: 0, items: 0 };
        const paid = (req.type === "money") ? wk.money : wk.items;
        totalPaid += paid;
        const statusClass = paid >= req.amount ? "tax-week tax-week--success" : "tax-week tax-week--danger";
        const statusIcon = paid >= req.amount ? "✔" : "✖";
        const title = paid >= req.amount ? "Requirement met" : "Requirement missed";
        html += `<td class=\"${statusClass}\" title=\"${title}\">${statusIcon}</td>`;
      });

      const expected = displayWeeks.length * req.amount;
      const balance = totalPaid - expected;
      const roundedPaid = Math.max(0, Math.round(totalPaid));
      const totalPaidDisplay = req.type === "money"
        ? `$${roundedPaid.toLocaleString()}`
        : `${roundedPaid.toLocaleString()} ${SETTINGS.taxItemName}`;

      html += `<td class=\"tax-table__cell tax-total-paid\">${totalPaidDisplay}</td>`;

      if (balance < 0) {
        html += `<td class=\"tax-table__cell tax-table__cell--sticky-right tax-balance tax-balance--owing\">Owes ${req.type === "money" ? "$" + Math.abs(balance).toLocaleString() : Math.abs(balance) + " " + SETTINGS.taxItemName}</td>`;
        owingList.push({ id, name: COMPANY_MEMBERS[id], amount: req.type === "money" ? "$" + Math.abs(balance).toLocaleString() : Math.abs(balance) + " " + SETTINGS.taxItemName });
      } else if (balance > 0) {
        html += `<td class=\"tax-table__cell tax-table__cell--sticky-right tax-balance tax-balance--overpaid\">Overpaid ${req.type === "money" ? "$" + balance.toLocaleString() : balance + " " + SETTINGS.taxItemName}</td>`;
      } else {
        html += `<td class=\"tax-table__cell tax-table__cell--sticky-right tax-balance tax-balance--ontime\">On Track</td>`;
      }

      if (req.type === "money") {
        totals.money.paid += Math.round(totalPaid);
        totals.money.balance += balance;
      } else {
        totals.items.paid += Math.round(totalPaid);
        totals.items.balance += balance;
      }

      html += `</tr>`;
    });

    const paidSummary = `Money: $${Math.max(0, Math.round(totals.money.paid)).toLocaleString()} • ${SETTINGS.taxItemName}: ${Math.max(0, Math.round(totals.items.paid)).toLocaleString()}`;
    const balanceSummaryParts = [];
    const moneyBalanceRounded = Math.round(totals.money.balance);
    const itemsBalanceRounded = Math.round(totals.items.balance);

    balanceSummaryParts.push(moneyBalanceRounded === 0
      ? "Money: On Track"
      : moneyBalanceRounded > 0
        ? `Money: Overpaid $${moneyBalanceRounded.toLocaleString()}`
        : `Money: Owes $${Math.abs(moneyBalanceRounded).toLocaleString()}`);
    balanceSummaryParts.push(itemsBalanceRounded === 0
      ? `${SETTINGS.taxItemName}: On Track`
      : itemsBalanceRounded > 0
        ? `${SETTINGS.taxItemName}: Overpaid ${itemsBalanceRounded.toLocaleString()} ${SETTINGS.taxItemName}`
        : `${SETTINGS.taxItemName}: Owes ${Math.abs(itemsBalanceRounded).toLocaleString()} ${SETTINGS.taxItemName}`);
    const balanceSummary = balanceSummaryParts.join(" • ");

    html += `</tbody><tfoot><tr><td class=\"tax-table__footer tax-total-cell\" colspan=\"${displayWeeks.length + 1}\">Totals</td><td class=\"tax-table__footer\">${paidSummary}</td><td class=\"tax-table__footer tax-table__cell--sticky-right\">${balanceSummary}</td></tr></tfoot></table></div>`;

    // Reminders box
    let reminderHtml = `<div class=\"tax-reminder-card\">`;
    reminderHtml += `<h4 class=\"tax-reminder-card__title\">Employees Owing Tax</h4>`;
    if (owingList.length === 0) {
      reminderHtml += `<p class=\"tax-reminder-card__empty\">All employees are fully paid up ✅</p>`;
    } else {
      reminderHtml += `<ul class=\"tax-reminder-card__list\">`;
      owingList.forEach(emp => {
        const msg = SETTINGS.reminderMessage
          .replace(/{name}/g, emp.name)
          .replace(/{id}/g, emp.id)
          .replace(/{amount}/g, emp.amount);
        const safeName = escapeHtml(emp.name);
        const safeAmount = escapeHtml(emp.amount);
        const safePreview = escapeHtml(msg);
        reminderHtml += `<li class=\"tax-reminder-card__item\">
          <div class=\"tax-reminder-card__details\">
            <span class=\"tax-reminder-card__name\">${safeName} [${emp.id}]</span>
            <span class=\"tax-reminder-card__amount\">Owes ${safeAmount}</span>
            <span class=\"tax-reminder-card__message\">${safePreview}</span>
          </div>
          <div class=\"tax-reminder-card__actions\">
            <button type=\"button\" data-id=\"${emp.id}\" data-name=\"${encodeURIComponent(emp.name)}\" data-msg=\"${encodeURIComponent(msg)}\"
              class=\"send-reminder tax-button tax-button--accent\">Send Reminder</button>
          </div></li>`;
      });
      reminderHtml += `</ul>`;
    }
    reminderHtml += `</div>`;

    container.innerHTML = html + reminderHtml;

    // Clipboard reminder handlers
    container.querySelectorAll(".send-reminder").forEach(link => {
      link.addEventListener("click", async e => {
        e.preventDefault();
        const empId = link.getAttribute("data-id");
        const empName = decodeURIComponent(link.getAttribute("data-name") || "");
        const msg = decodeURIComponent(link.getAttribute("data-msg"));

        sessionStoreSet(REMINDER_MESSAGE_KEY, msg);
        sessionStoreSet(REMINDER_TARGET_KEY, empId || "");
        sessionStoreSet(REMINDER_TARGET_NAME_KEY, empName);

        let copied = false;
        try {
          copied = await copyTextToClipboard(msg);
        } catch (err) {
          console.warn("Failed to copy reminder message", err);
        }

        if (copied) {
          showToast("Reminder copied. Compose window opened in a new tab.");
        } else {
          showToast("Compose window opened. Reminder will auto-fill there.");
        }

        window.open(`https://www.torn.com/messages.php#/p=compose&XID=${empId}&taxReminder=1`, "_blank");

        setTimeout(() => {
          if (sessionStoreGet(REMINDER_MESSAGE_KEY) === msg) {
            sessionStoreRemove(REMINDER_MESSAGE_KEY, REMINDER_TARGET_KEY, REMINDER_TARGET_NAME_KEY);
          }
        }, 5 * 60 * 1000);
      });
    });
  }

  // --- Helpers

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, char => {
      switch (char) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        case "'": return "&#39;";
        default: return char;
      }
    });
  }

  function safe(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  // Week math (same simple week number style as your original)
  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return [d.getUTCFullYear(), weekNo];
  }

  function generateWeekMapFrom(startYear, startWeek) {
    const map = {};
    const now = new Date();
    const [cy, cw] = getWeekNumber(now);
    for (let y = startYear; y <= cy; y++) {
      const lastW = (y === cy) ? cw : 53; // generous upper bound
      for (let w = (y === startYear ? startWeek : 1); w <= lastW; w++) {
        map[`${y}-W${w}`] = true;
      }
    }
    return map;
  }
  function generateWeekKeys(startYear, startWeek) {
    return Object.keys(generateWeekMapFrom(startYear, startWeek));
  }

  function makeDraggable(el, handle) {
    let offsetX = 0, offsetY = 0, isDown = false;
    const dragHandle = handle || el;

    function ensureFreePosition() {
      const computed = window.getComputedStyle(el);
      if (computed.transform && computed.transform !== 'none') {
        const rect = el.getBoundingClientRect();
        el.style.transform = 'none';
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;
      }
    }

    dragHandle.addEventListener('mousedown', e => {
      ensureFreePosition();
      isDown = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.body.style.userSelect = "none";
    });
    document.addEventListener('mouseup', () => {
      isDown = false;
      document.body.style.userSelect = "";
    });
    document.addEventListener('mousemove', e => {
      if (!isDown) return;
      const rect = el.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const newLeft = Math.min(Math.max(e.clientX - offsetX, 10), Math.max(10, window.innerWidth - width - 10));
      const newTop = Math.min(Math.max(e.clientY - offsetY, 10), Math.max(10, window.innerHeight - height - 10));
      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
    });
  }

  function clampElementWithinViewport(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    const width = rect.width;
    const height = rect.height;
    const clampedLeft = Math.min(Math.max(rect.left, 10), Math.max(10, window.innerWidth - width - 10));
    const clampedTop = Math.min(Math.max(rect.top, 10), Math.max(10, window.innerHeight - height - 10));
    el.style.left = `${clampedLeft}px`;
    el.style.top = `${clampedTop}px`;
    const position = window.getComputedStyle(el).position;
    if (position === "fixed" || position === "absolute") {
      el.style.right = "auto";
      el.style.bottom = "auto";
    }
  }

  function prepareFloatingButton(btn) {
    if (!btn) return;
    clampElementWithinViewport(btn);
    makeDraggable(btn, btn);
    window.addEventListener('resize', () => clampElementWithinViewport(btn));
  }

  function makeResizable(el) {
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "tax-resize-handle";
    el.appendChild(resizeHandle);

    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let maxWidth = 0;
    let maxHeight = 0;
    let minWidth = 0;
    let minHeight = 0;

    function ensureFreePosition() {
      const computed = window.getComputedStyle(el);
      if (computed.transform && computed.transform !== 'none') {
        const rect = el.getBoundingClientRect();
        el.style.transform = 'none';
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;
      }
    }

    function parseSize(value, fallback) {
      const parsed = parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function onMouseDown(e) {
      e.preventDefault();
      ensureFreePosition();
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
      const style = window.getComputedStyle(el);
      minWidth = parseSize(style.minWidth, 320);
      minHeight = parseSize(style.minHeight, 240);
      maxWidth = Math.max(minWidth, window.innerWidth - rect.left - 16);
      maxHeight = Math.max(minHeight, window.innerHeight - rect.top - 16);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "none";
    }

    function onMouseMove(e) {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const newWidth = Math.min(Math.max(startWidth + deltaX, minWidth), maxWidth);
      const newHeight = Math.min(Math.max(startHeight + deltaY, minHeight), maxHeight);
      el.style.width = `${newWidth}px`;
      el.style.height = `${newHeight}px`;
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
    }

    resizeHandle.addEventListener("mousedown", onMouseDown);
  }

  async function copyTextToClipboard(text) {
    if (!text) return false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn("navigator.clipboard.writeText failed", err);
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (err) {
      success = false;
      console.warn("document.execCommand copy failed", err);
    }
    textarea.remove();
    return success;
  }

  function showToast(message, { duration = 2600 } = {}) {
    if (!message || !document.body) return;
    document.querySelectorAll(".tax-toast").forEach(el => el.remove());
    const toast = document.createElement("div");
    toast.className = "tax-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function setInitialModalSize(modal, preferredWidth, preferredHeight) {
    if (!modal) return;
    const availableWidth = Math.max(320, window.innerWidth - 48);
    const availableHeight = Math.max(320, window.innerHeight - 48);
    if (preferredWidth) {
      modal.style.width = `${Math.min(preferredWidth, availableWidth)}px`;
    }
    if (preferredHeight) {
      modal.style.height = `${Math.min(preferredHeight, availableHeight)}px`;
    }
  }

  function autoFillReminderMessage() {
    if (typeof window === "undefined") return;
    if (!window.location.pathname.endsWith("/messages.php")) return;
    const hash = window.location.hash || "";
    if (!hash.includes("p=compose")) return;

    if (!document.body) {
      document.addEventListener("DOMContentLoaded", autoFillReminderMessage, { once: true });
      return;
    }

    const storedMessage = sessionStoreGet(REMINDER_MESSAGE_KEY);
    if (!storedMessage) return;

    const targetId = sessionStoreGet(REMINDER_TARGET_KEY) || "";
    const targetName = sessionStoreGet(REMINDER_TARGET_NAME_KEY) || "";

    let observer;
    let timeoutId;

    const cleanup = () => {
      if (observer) observer.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
      sessionStoreRemove(REMINDER_MESSAGE_KEY, REMINDER_TARGET_KEY, REMINDER_TARGET_NAME_KEY);
    };

    const applyMessage = () => {
      const textarea = findComposeTextarea();
      if (!textarea) return false;

      if (!textarea.value || textarea.value.trim() === "" || textarea.value === storedMessage) {
        textarea.value = storedMessage;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
      textarea.focus();

      const descriptor = targetName || (targetId ? `ID ${targetId}` : "");
      const toastText = descriptor
        ? `Reminder message ready to send to ${descriptor}.`
        : "Reminder message ready to send.";
      showToast(toastText, { duration: 3200 });

      cleanup();
      return true;
    };

    if (applyMessage()) {
      return;
    }

    observer = new MutationObserver(() => {
      if (applyMessage()) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    timeoutId = setTimeout(() => {
      cleanup();
    }, 20000);
  }

  function findComposeTextarea() {
    const selectors = [
      ".mail-compose textarea",
      ".mail-write textarea",
      "textarea[name=\"compose-message\"]",
      "textarea[name=\"message\"]",
      "textarea[name=\"mailbox-message\"]",
      "textarea#mailContent",
      "textarea"
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      if (selector === "textarea") {
        const container = el.closest('[class*="compose" i], [id*="compose" i], [class*="mail" i]');
        if (!container) continue;
      }
      if (el.offsetParent === null) {
        continue;
      }
      return el;
    }
    return null;
  }

  function sessionStoreGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (err) {
      console.warn("Unable to read sessionStorage", err);
      return null;
    }
  }

  function sessionStoreSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (err) {
      console.warn("Unable to write to sessionStorage", err);
    }
  }

  function sessionStoreRemove(...keys) {
    keys.forEach(key => {
      try {
        sessionStorage.removeItem(key);
      } catch (err) {
        console.warn("Unable to remove sessionStorage key", err);
      }
    });
  }

  function makeFakeData() {
    const employees = {
      101: "Alice", 102: "Bob", 103: "Charlie", 104: "Diana"
    };
    const weekKeys = generateWeekKeys(SETTINGS.startYear, SETTINGS.startWeek);
    const weeklyData = {};
    weekKeys.forEach(wk => {
      weeklyData[wk] = {};
      Object.keys(employees).forEach(id => {
        // Randomly pay either money or items to simulate
        if (!SETTINGS.memberRequirements[id]) {
          SETTINGS.memberRequirements[id] = (Math.random() < 0.5)
            ? { type: "money", amount: SETTINGS.defaultMoneyTax }
            : { type: "xanax", amount: SETTINGS.defaultItemTax };
        }
        const req = SETTINGS.memberRequirements[id];
        const miss = Math.random() < 0.25;
        const over = Math.random() > 0.85;
        const paid = miss ? 0 : (over ? req.amount * 2 : req.amount);
        weeklyData[wk][id] = { money: 0, items: 0 };
        if (req.type === "money") weeklyData[wk][id].money = paid;
        else weeklyData[wk][id].items = paid;
      });
    });
    saveSettings(SETTINGS);
    return { employees, weeklyData };
  }
})();
