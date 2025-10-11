// ==UserScript==
// @name         Torn Lingerie Store Tax Tracker
// @namespace    http://tampermonkey.net/
// @version      6.3
// @description  Track weekly company tax from employees in Torn with Torn-styled table, draggable/resizable panel, reminders, overpayment tracking, totals row, and Test Mode.
// @author       Hooded_Prince
// @match        https://www.torn.com/*
// @grant        none
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/552053/Torn%20Lingerie%20Store%20Tax%20Tracker.user.js
// @updateURL https://update.greasyfork.org/scripts/552053/Torn%20Lingerie%20Store%20Tax%20Tracker.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY_SETTINGS = "torn_tax_settings_v4";
  const STORAGE_KEY_ITEM_CATALOG = "torn_tax_item_catalog_v1";
  const ITEM_CATALOG_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

  const DEFAULT_SETTINGS = {
    startYear: new Date().getUTCFullYear(),
    startWeek: 40,
    maxWeeks: 12,
    manualMode: false,
    manualMembers: {},
    apiKey: "",
    testMode: false,
    // Per-member overrides
    memberRequirements: {},
    defaultMoneyTax: 10000000,
    defaultItemTax: 7,
    defaultRequirementType: "money",
    taxItemName: "Xanax",
    reminderMessage: "Hi {name}, you currently owe {amount}. Please pay as soon as possible. Thanks!",
    enableEmployeeMenu: false,
    // Legacy field kept for backwards compatibility with older saves
    requiredTax: 10000000
  };

  function loadSettings() {
    const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
    return saved ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(saved)) : DEFAULT_SETTINGS;
  }
  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(s));
  }

  function normalizeItemName(name) {
    return typeof name === 'string' ? name.trim().toLowerCase() : '';
  }

  function normalizeItemId(id) {
    if (id === undefined || id === null) {
      return undefined;
    }
    const numeric = Number(id);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  function loadItemCatalog() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ITEM_CATALOG);
      if (!saved) {
        return { timestamp: 0, byName: {}, byId: {} };
      }
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') {
        return { timestamp: 0, byName: {}, byId: {} };
      }
      const timestamp = Number(parsed.timestamp) || 0;
      const byName = parsed.byName && typeof parsed.byName === 'object' ? parsed.byName : {};
      const byId = parsed.byId && typeof parsed.byId === 'object' ? parsed.byId : {};
      return { timestamp, byName, byId };
    } catch (err) {
      console.warn('Failed to load item catalog', err);
      return { timestamp: 0, byName: {}, byId: {} };
    }
  }

  function saveItemCatalog(catalog) {
    try {
      localStorage.setItem(STORAGE_KEY_ITEM_CATALOG, JSON.stringify(catalog));
    } catch (err) {
      console.warn('Failed to save item catalog', err);
    }
  }

  function ensureCatalogShape(catalog) {
    if (!catalog || typeof catalog !== 'object') {
      return { timestamp: 0, byName: {}, byId: {} };
    }
    if (!catalog.byName || typeof catalog.byName !== 'object') {
      catalog.byName = {};
    }
    if (!catalog.byId || typeof catalog.byId !== 'object') {
      catalog.byId = {};
    }
    if (!Number.isFinite(Number(catalog.timestamp))) {
      catalog.timestamp = 0;
    }
    return catalog;
  }

  let ITEM_CATALOG = ensureCatalogShape(loadItemCatalog());

  function recordItemMapping(byName, key, info) {
    if (!key || byName[key]) {
      return;
    }
    byName[key] = info;
  }

  async function ensureItemCatalog() {
    const now = Date.now();
    if (ITEM_CATALOG && ITEM_CATALOG.timestamp && (now - ITEM_CATALOG.timestamp) < ITEM_CATALOG_MAX_AGE && Object.keys(ITEM_CATALOG.byName).length > 0) {
      return ITEM_CATALOG;
    }
    if (!SETTINGS.apiKey) {
      return ITEM_CATALOG;
    }
    try {
      const res = await fetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(SETTINGS.apiKey)}`);
      const data = await res.json();
      if (!data || data.error || !data.items || typeof data.items !== 'object') {
        if (!ITEM_CATALOG.timestamp || (now - ITEM_CATALOG.timestamp) >= ITEM_CATALOG_MAX_AGE) {
          ITEM_CATALOG.timestamp = now;
          saveItemCatalog(ITEM_CATALOG);
        }
        return ITEM_CATALOG;
      }
      const byName = {};
      const byId = {};
      Object.keys(data.items).forEach(id => {
        const item = data.items[id];
        const numericId = normalizeItemId(id);
        if (!item || numericId === undefined) {
          return;
        }
        const baseNames = [item.name, item.item, item.itemname, item.itemName, item.title, item.plural];
        const primaryName = baseNames.find(name => typeof name === 'string' && name.trim());
        const candidateNames = baseNames.filter(name => typeof name === 'string');
        if (Array.isArray(item.aliases)) {
          item.aliases.forEach(alias => {
            if (typeof alias === 'string') {
              candidateNames.push(alias);
            }
          });
        }
        candidateNames.forEach(candidate => {
          const key = normalizeItemName(candidate);
          if (!key) {
            return;
          }
          recordItemMapping(byName, key, { id: numericId, name: primaryName || candidate });
        });
        byId[numericId] = { name: primaryName || '' };
      });
      ITEM_CATALOG = ensureCatalogShape({ timestamp: now, byName, byId });
      saveItemCatalog(ITEM_CATALOG);
    } catch (err) {
      console.warn('Failed to fetch item catalog', err);
    }
    return ITEM_CATALOG;
  }

  function getItemIdForName(name) {
    if (!ITEM_CATALOG || !ITEM_CATALOG.byName) {
      return undefined;
    }
    const key = normalizeItemName(name);
    if (!key) {
      return undefined;
    }
    const entry = ITEM_CATALOG.byName[key];
    if (!entry || entry.id === undefined) {
      return undefined;
    }
    const numeric = normalizeItemId(entry.id);
    return numeric;
  }

  let SETTINGS = loadSettings();

  // Migrate legacy saves that only had a single required tax amount
  if (SETTINGS.requiredTax && !SETTINGS.defaultMoneyTax) {
    SETTINGS.defaultMoneyTax = SETTINGS.requiredTax;
  }
  if (!SETTINGS.memberRequirements) {
    SETTINGS.memberRequirements = {};
  }
  if (!SETTINGS.reminderMessage) {
    SETTINGS.reminderMessage = DEFAULT_SETTINGS.reminderMessage;
  }
  if (typeof SETTINGS.enableEmployeeMenu !== "boolean") {
    SETTINGS.enableEmployeeMenu = DEFAULT_SETTINGS.enableEmployeeMenu;
  }
  if (!SETTINGS.taxItemName) {
    SETTINGS.taxItemName = DEFAULT_SETTINGS.taxItemName;
  }
  if (!SETTINGS.defaultItemTax) {
    SETTINGS.defaultItemTax = DEFAULT_SETTINGS.defaultItemTax;
  }
  if (SETTINGS.defaultRequirementType !== "item" && SETTINGS.defaultRequirementType !== "money") {
    SETTINGS.defaultRequirementType = DEFAULT_SETTINGS.defaultRequirementType;
  }

  let lastEmployeesCache = {};
  let lastWeeklyDataCache = {};

  function getDefaultRequirement() {
    const type = SETTINGS.defaultRequirementType === 'item' ? 'item' : 'money';
    const amount = type === 'item' ? SETTINGS.defaultItemTax : SETTINGS.defaultMoneyTax;
    return { type, amount, isDefault: true };
  }

  function getMemberRequirement(id) {
    if (!SETTINGS.enableEmployeeMenu) {
      return getDefaultRequirement();
    }
    const req = SETTINGS.memberRequirements[id];
    if (!req || req.useDefault) {
      return getDefaultRequirement();
    }
    const type = req.type === 'item' ? 'item' : 'money';
    const fallback = type === 'item' ? SETTINGS.defaultItemTax : SETTINGS.defaultMoneyTax;
    const amount = Number.isFinite(req.amount) ? req.amount : fallback;
    return { type, amount, isDefault: false };
  }

  // Floating open button
  const button = document.createElement("button");
  Object.assign(button.style, {
    position: "fixed", top: "30%", right: "0%", zIndex: "9999",
    backgroundColor: "#2e8b57", color: "#fff", border: "none",
    padding: "6px 10px", borderRadius: "6px 0 0 6px", cursor: "pointer"
  });
  button.textContent = "Tax";
  document.body.appendChild(button);

  // Panel shell
  const panel = document.createElement("div");
  panel.id = "tax-panel";
  Object.assign(panel.style, {
    display: "none", position: "fixed", top: "10%", left: "10%",
    width: "80%", height: "75%", background: "#1b1b1b", color: "#ccc",
    padding: "0", zIndex: "10000", borderRadius: "6px", overflow: "hidden",
    boxShadow: "0px 0px 15px rgba(0,0,0,0.7)", border: "1px solid #333",
    fontFamily: "Verdana, sans-serif"
  });

  panel.innerHTML = `
    <div id="drag-bar" style="cursor:move;background:#2a2a2a;color:#fff;padding:6px 10px;border-bottom:1px solid #444;display:flex;align-items:center;gap:8px;">
      <span style="font-weight:bold;flex:1;">Weekly Tax Tracker</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <button id="openOverview" style="background:#2e8b57;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Overview</button>
        <button id="openEmployeeMenu" style="display:${SETTINGS.enableEmployeeMenu ? "inline-block" : "none"};background:#444;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Employees</button>
        <button id="editSettings" style="background:#444;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Settings</button>
        <button id="editEmployees" style="display:${SETTINGS.manualMode ? "inline-block" : "none"};background:#555;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Edit Employees</button>
        <button id="close-tax" style="background:#b30000;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">X</button>
      </div>
    </div>
    <div id="viewContainer" style="height:calc(100% - 44px);">
      <div id="overviewView" style="height:100%;overflow:auto;padding:10px;"></div>
      <div id="employeeView" style="display:none;height:100%;overflow:auto;padding:10px;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const overviewView = panel.querySelector("#overviewView");
  const employeeView = panel.querySelector("#employeeView");
  const overviewButton = panel.querySelector("#openOverview");
  const employeeButton = panel.querySelector("#openEmployeeMenu");
  let currentView = "overview";

  function switchView(view) {
    if (view === "employees" && !SETTINGS.enableEmployeeMenu) {
      view = "overview";
    }
    currentView = view;

    if (overviewView) {
      overviewView.style.display = view === "overview" ? "block" : "none";
    }
    if (employeeView) {
      employeeView.style.display = view === "employees" ? "block" : "none";
      if (view !== "employees") {
        employeeView.scrollTop = 0;
      }
    }

    if (overviewButton) {
      overviewButton.style.background = view === "overview" ? "#2e8b57" : "#444";
      overviewButton.style.color = "white";
    }
    if (employeeButton) {
      employeeButton.style.background = view === "employees" ? "#2e8b57" : "#444";
      employeeButton.style.color = "white";
    }
  }

  makeDraggable(panel, panel.querySelector("#drag-bar"));
  makeResizable(panel);

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
  overviewButton.addEventListener("click", () => {
    switchView("overview");
    if (Object.keys(lastWeeklyDataCache).length === 0) {
      fetchData();
    }
  });
  if (employeeButton) {
    employeeButton.addEventListener("click", () => {
      switchView("employees");
      if (!SETTINGS.enableEmployeeMenu) return;
      if (Object.keys(lastEmployeesCache).length === 0) {
        fetchData();
      } else {
        renderEmployeeMenu(lastEmployeesCache);
      }
    });
  }

  switchView("overview");

  function showApiPrompt() {
    const editor = document.createElement("div");
    Object.assign(editor.style, {
      position: "fixed", top: "30%", left: "35%", width: "30%",
      background: "#222", color: "#fff", padding: "15px", zIndex: "11000",
      borderRadius: "6px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)"
    });
    editor.innerHTML = `
      <h3 style="margin:0 0 10px 0;">Enter Torn API Key</h3>
      <input id="apiInput" type="text" value="${SETTINGS.apiKey}" style="width:100%;padding:6px;background:#111;color:#0f0;border:1px solid #555;">
      <div style="text-align:right;margin-top:10px;">
        <button id="saveApi" style="background:#2e8b57;color:white;padding:5px 10px;border:none;border-radius:4px;cursor:pointer;">Save</button>
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

  function showSettingsEditor() {
    const editor = document.createElement("div");
    Object.assign(editor.style, {
      position: "fixed", top: "18%", left: "34%", width: "32%",
      background: "#222", color: "#fff", padding: "15px", zIndex: "11000",
      borderRadius: "8px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)"
    });

    editor.innerHTML = `
      <h3 style="margin:0 0 10px 0;">Settings</h3>
      <label>Start Year:
        <input id="setYear" type="number" value="${SETTINGS.startYear}" style="width:90px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
      </label><br><br>
      <label>Start Week:
        <input id="setWeek" type="number" value="${SETTINGS.startWeek}" style="width:90px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
      </label><br><br>
      <label>Max Weeks to Display:
        <input id="setMaxWeeks" type="number" value="${SETTINGS.maxWeeks}" style="width:90px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
      </label><br><br>
      <label><input id="manualMode" type="checkbox" ${SETTINGS.manualMode ? "checked" : ""}> Manual Employees Mode</label><br><br>
      <label><input id="testMode" type="checkbox" ${SETTINGS.testMode ? "checked" : ""}> Enable Test Mode (fake data)</label><br><br>
      <label><input id="enableEmployeeMenu" type="checkbox" ${SETTINGS.enableEmployeeMenu ? "checked" : ""}> Enable Employees Menu</label>

      <fieldset style="border:1px solid #444;border-radius:6px;padding:10px;margin-top:12px;">
        <legend style="padding:0 6px;color:#0f0;">Defaults for New Employees</legend>
        <label>Default Requirement Type:
          <select id="setDefaultRequirementType" style="width:160px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
            <option value="money" ${SETTINGS.defaultRequirementType === "item" ? "" : "selected"}>Money</option>
            <option value="item" ${SETTINGS.defaultRequirementType === "item" ? "selected" : ""}>${SETTINGS.taxItemName}</option>
          </select>
        </label><br><br>
        <label>Default Money Tax:
          <input id="setDefaultMoney" type="number" value="${SETTINGS.defaultMoneyTax}" style="width:140px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
        </label><br><br>
        <label>Item Name:
          <input id="setItemName" type="text" value="${SETTINGS.taxItemName}" style="width:140px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
        </label><br><br>
        <label>Default Item Tax:
          <input id="setDefaultItem" type="number" value="${SETTINGS.defaultItemTax}" style="width:140px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
        </label>
      </fieldset>

      <label style="display:block;margin-top:12px;">Reminder Message:
        <textarea id="setReminder" style="width:100%;height:80px;background:#111;color:#0f0;border:1px solid #555;margin-top:6px;">${SETTINGS.reminderMessage}</textarea>
        <small style="color:#ccc;">Use placeholders: {name}, {id}, {amount}</small>
      </label>

      <div style="text-align:right;margin-top:12px;">
        <button id="saveSet" style="background:#2e8b57;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Save</button>
        <button id="cancelSet" style="background:#555;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
      </div>
    `;
    document.body.appendChild(editor);
    const defaultTypeSelect = editor.querySelector("#setDefaultRequirementType");
    const itemNameInput = editor.querySelector("#setItemName");
    if (defaultTypeSelect && itemNameInput) {
      const updateItemLabel = () => {
        const option = defaultTypeSelect.querySelector('option[value="item"]');
        if (option) {
          const name = itemNameInput.value.trim() || DEFAULT_SETTINGS.taxItemName;
          option.textContent = name;
        }
      };
      updateItemLabel();
      itemNameInput.addEventListener("input", updateItemLabel);
    }
    editor.querySelector("#cancelSet").addEventListener("click", () => editor.remove());
    editor.querySelector("#saveSet").addEventListener("click", () => {
      SETTINGS.startYear = parseInt(editor.querySelector("#setYear").value, 10);
      SETTINGS.startWeek = parseInt(editor.querySelector("#setWeek").value, 10);
      SETTINGS.maxWeeks = parseInt(editor.querySelector("#setMaxWeeks").value, 10);
      SETTINGS.manualMode = editor.querySelector("#manualMode").checked;
      SETTINGS.testMode = editor.querySelector("#testMode").checked;
      SETTINGS.enableEmployeeMenu = editor.querySelector("#enableEmployeeMenu").checked;
      const typeSelect = editor.querySelector("#setDefaultRequirementType");
      SETTINGS.defaultRequirementType = typeSelect && typeSelect.value === "item" ? "item" : "money";
      SETTINGS.defaultMoneyTax = parseInt(editor.querySelector("#setDefaultMoney").value, 10) || DEFAULT_SETTINGS.defaultMoneyTax;
      SETTINGS.taxItemName = (editor.querySelector("#setItemName").value || DEFAULT_SETTINGS.taxItemName).trim();
      SETTINGS.defaultItemTax = parseInt(editor.querySelector("#setDefaultItem").value, 10) || DEFAULT_SETTINGS.defaultItemTax;
      SETTINGS.reminderMessage = editor.querySelector("#setReminder").value.trim() || DEFAULT_SETTINGS.reminderMessage;
      SETTINGS.requiredTax = SETTINGS.defaultMoneyTax;
      const defaults = getDefaultRequirement();
      Object.keys(SETTINGS.memberRequirements).forEach(id => {
        const req = SETTINGS.memberRequirements[id];
        if (req && req.useDefault) {
          req.type = defaults.type;
          req.amount = defaults.amount;
        }
      });
      saveSettings(SETTINGS);
      editor.remove();
      panel.querySelector("#editEmployees").style.display = SETTINGS.manualMode ? "inline-block" : "none";
      if (employeeButton) {
        employeeButton.style.display = SETTINGS.enableEmployeeMenu ? "inline-block" : "none";
      }
      if (!SETTINGS.enableEmployeeMenu && currentView === "employees") {
        switchView("overview");
      }
      fetchData();
    });
  }

  function showEmployeeEditor() {
    const editor = document.createElement("div");
    Object.assign(editor.style, {
      position: "fixed", top: "20%", left: "30%", width: "40%",
      background: "#222", color: "#fff", padding: "15px", zIndex: "11000",
      borderRadius: "8px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)"
    });

    let text = "";
    Object.keys(SETTINGS.manualMembers).forEach(id => {
      const req = getMemberRequirement(id);
      text += `${id}:${SETTINGS.manualMembers[id]}:${req.type}:${req.amount}\n`;
    });

    editor.innerHTML = `
      <h3 style="margin:0 0 10px 0;">Manual Employees (id:name:type:amount)</h3>
      <textarea id="empInput" style="width:100%;height:220px;background:#111;color:#0f0;border:1px solid #555;">${text.trim()}</textarea>
      <small style="display:block;margin-top:6px;color:#ccc;">Type may be "money" or "item". Amount should match the requirement.</small>
      <div style="text-align:right;margin-top:10px;">
        <button id="saveEmp" style="background:#2e8b57;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Save</button>
        <button id="cancelEmp" style="background:#555;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
      </div>
    `;
    document.body.appendChild(editor);

    editor.querySelector("#cancelEmp").addEventListener("click", () => editor.remove());
    editor.querySelector("#saveEmp").addEventListener("click", () => {
      const lines = editor.querySelector("#empInput").value.split("\n");
      const newList = {};
      const newReqs = {};
      lines.forEach(line => {
        if (!line.trim()) return;
        const parts = line.split(":").map(x => x.trim());
        const [id, name, type, amount] = parts;
        if (id && name) {
          newList[id] = name;
          const normalizedType = (type === "item" ? "item" : "money");
          const parsedAmount = parseInt(amount || (normalizedType === "money" ? SETTINGS.defaultMoneyTax : SETTINGS.defaultItemTax), 10);
          newReqs[id] = { type: normalizedType, amount: isNaN(parsedAmount) ? (normalizedType === "money" ? SETTINGS.defaultMoneyTax : SETTINGS.defaultItemTax) : parsedAmount, useDefault: false };
        }
      });
      SETTINGS.manualMembers = newList;
      // Remove requirements for employees no longer present
      Object.keys(SETTINGS.memberRequirements).forEach(id => {
        if (!newList[id]) {
          delete SETTINGS.memberRequirements[id];
        }
      });
      SETTINGS.memberRequirements = Object.assign({}, SETTINGS.memberRequirements, newReqs);
      saveSettings(SETTINGS);
      editor.remove();
      fetchData();
    });
  }

  async function fetchData() {
    let employees = {};
    let weeklyData = {};

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

      Object.keys(SETTINGS.memberRequirements).forEach(id => {
        if (!employees[id]) {
          delete SETTINGS.memberRequirements[id];
        }
      });

      const defaults = getDefaultRequirement();
      Object.keys(employees).forEach(id => {
        if (!SETTINGS.memberRequirements[id]) {
          SETTINGS.memberRequirements[id] = { type: defaults.type, amount: defaults.amount, useDefault: true };
          return;
        }
        if (SETTINGS.memberRequirements[id].useDefault) {
          SETTINGS.memberRequirements[id].type = defaults.type;
          SETTINGS.memberRequirements[id].amount = defaults.amount;
        }
      });

      const usesItemTracking = SETTINGS.defaultRequirementType === 'item' || Object.values(SETTINGS.memberRequirements).some(req => req && req.type === 'item');

      const moneyRes = await fetch(`https://api.torn.com/user/?selections=log&log=4800,4810&key=${encodeURIComponent(SETTINGS.apiKey)}`);
      const moneyData = await moneyRes.json();

      const itemRes = await fetch(`https://api.torn.com/user/?selections=log&cat=85&key=${encodeURIComponent(SETTINGS.apiKey)}`);
      const itemData = await itemRes.json();

      const logs = { ...(moneyData && moneyData.log ? moneyData.log : {}), ...(itemData && itemData.log ? itemData.log : {}) };
      const employeeNameIndex = buildEmployeeNameIndex(employees);

      const weekMap = generateWeekMapFrom(SETTINGS.startYear, SETTINGS.startWeek);
      Object.keys(weekMap).forEach(key => {
        weeklyData[key] = {};
      });

      for (const id in logs) {
        const log = logs[id];
        const ts = new Date(log.timestamp * 1000);
        const [year, week] = getWeekNumber(ts);
        if (year < SETTINGS.startYear || (year === SETTINGS.startYear && week < SETTINGS.startWeek)) continue;
        const weekKey = `${year}-W${week}`;

        const senderId = findEmployeeIdFromLog(log, employees, employeeNameIndex);
        if (!senderId) continue;

        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = {};
        }
        if (!weeklyData[weekKey][senderId]) {
          weeklyData[weekKey][senderId] = { money: 0, items: 0 };
        }

        const logType = Number(log.log);
        const logCategory = Number(log.category);

        if (logType === 4800 || logType === 4810) {
          const amount = Number(log?.data?.money ?? log?.data?.amount ?? 0);
          if (Number.isFinite(amount)) {
            weeklyData[weekKey][senderId].money += amount;
          }
        } else if (usesItemTracking && logCategory === 85) {
          const targetId = 206; // Xanax
          const targetName = SETTINGS.taxItemName || "Xanax";
          const qty = getItemQuantityFromLog(log, targetName, targetId);
          if (qty > 0) {
            weeklyData[weekKey][senderId].items += qty;
          }
        }
      }
    }

    lastEmployeesCache = employees;
    lastWeeklyDataCache = weeklyData;
    saveSettings(SETTINGS);

    renderOverview(weeklyData, employees);
    if (SETTINGS.enableEmployeeMenu) {
      renderEmployeeMenu(employees);
    }
    if (!SETTINGS.enableEmployeeMenu && currentView === "employees") {
      switchView("overview");
    }
  }

  

  function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return [d.getUTCFullYear(), weekNo];
  }

  function makeDraggable(el, handle) {
    let offsetX = 0, offsetY = 0, isDown = false;
    handle.addEventListener('mousedown', e => { isDown = true; offsetX = el.offsetLeft - e.clientX; offsetY = el.offsetTop - e.clientY; document.body.style.userSelect = "none"; });
    document.addEventListener('mouseup', () => { isDown = false; document.body.style.userSelect = ""; });
    document.addEventListener('mousemove', e => { if (isDown) { el.style.left = (e.clientX + offsetX) + 'px'; el.style.top = (e.clientY + offsetY) + 'px'; } });
  }

  function makeResizable(el) {
    const resizeHandle = document.createElement("div");
    Object.assign(resizeHandle.style, { width: "15px", height: "15px", background: "#444",
      position: "absolute", right: "0", bottom: "0", cursor: "se-resize", borderTopLeftRadius: "4px" });
    el.appendChild(resizeHandle);
    resizeHandle.addEventListener("mousedown", e => { e.preventDefault(); document.addEventListener("mousemove", resizePanel); document.addEventListener("mouseup", stopResize); });
    function resizePanel(e) { el.style.width = (e.clientX - el.offsetLeft) + "px"; el.style.height = (e.clientY - el.offsetTop) + "px"; }
    function stopResize() { document.removeEventListener("mousemove", resizePanel); document.removeEventListener("mouseup", stopResize); }
  }

  function makeFakeData() {
    const employees = {
      101: 'Alice',
      102: 'Bob',
      103: 'Charlie',
      104: 'Diana'
    };
    const weeklyData = {};
    const weekKeys = generateWeekKeys(SETTINGS.startYear, SETTINGS.startWeek);
    weekKeys.forEach(weekKey => {
      weeklyData[weekKey] = {};
      Object.keys(employees).forEach(id => {
        if (!SETTINGS.memberRequirements[id]) {
          const type = Math.random() < 0.5 ? 'money' : 'item';
          SETTINGS.memberRequirements[id] = {
            type,
            amount: type === 'money' ? SETTINGS.defaultMoneyTax : SETTINGS.defaultItemTax,
            useDefault: false
          };
        }
        const req = getMemberRequirement(id);
        const miss = Math.random() < 0.25;
        const over = Math.random() > 0.85;
        const paidAmount = miss ? 0 : over ? req.amount * 2 : req.amount;
        weeklyData[weekKey][id] = { money: 0, items: 0 };
        if (req.type === 'item') {
          weeklyData[weekKey][id].items = paidAmount;
        } else {
          weeklyData[weekKey][id].money = paidAmount;
        }
      });
    });
    saveSettings(SETTINGS);
    return { employees, weeklyData };
  }
  function renderOverview(weeklyData, COMPANY_MEMBERS) {
    if (!overviewView) return;
    const weekKeys = generateWeekKeys(SETTINGS.startYear, SETTINGS.startWeek);
    const displayWeeks = weekKeys.slice(-SETTINGS.maxWeeks);
    const allWeeks = weekKeys;

    if (displayWeeks.length === 0) {
      overviewView.innerHTML = '<p style="color:#ccc;">No weeks available for the selected start week.</p>';
      return;
    }

    const employeeIds = Object.keys(COMPANY_MEMBERS);
    if (employeeIds.length === 0) {
      overviewView.innerHTML = '<p style="color:#ccc;">No employees loaded yet. Fetch data to view tax progress.</p>';
      return;
    }

    let grandMoneyPaid = 0;
    let grandMoneyExpected = 0;
    let grandItemPaid = 0;
    let grandItemExpected = 0;
    const owingList = [];

    let html = '<div style="overflow:auto;"><table style="width:100%; border-collapse: collapse; text-align:center; font-size:12px; background:#1b1b1b; color:#ccc;">';
    html += '<thead><tr style="background:#2a2a2a; color:#fff; font-weight:bold;">';
    html += '<th style="padding:8px;border:1px solid #444;text-align:left;position:sticky;left:0;background:#2a2a2a;z-index:2;">Employee</th>';
    displayWeeks.forEach(week => {
      html += `<th style="padding:8px;border:1px solid #444;">${week}</th>`;
    });
    html += '<th style="padding:8px;border:1px solid #444;position:sticky;right:140px;background:#2a2a2a;z-index:2;">Total Paid</th>';
    html += '<th style="padding:8px;border:1px solid #444;position:sticky;right:0;background:#2a2a2a;z-index:2;">Balance</th></tr></thead><tbody>';

    employeeIds.forEach((id, idx) => {
      const req = getMemberRequirement(id);
      const type = req.type === 'item' ? 'item' : 'money';
      const rowBg = (idx % 2 === 0) ? '#202020' : '#262626';
      const totalPaid = allWeeks.reduce((sum, week) => {
        const data = (weeklyData[week] && weeklyData[week][id]) || { money: 0, items: 0 };
        return sum + (type === 'money' ? data.money : data.items);
      }, 0);

      html += `<tr style="background:${rowBg};">`;
      html += `<td style="padding:6px;border:1px solid #444;text-align:left;color:#fff;position:sticky;left:0;background:${rowBg};">${COMPANY_MEMBERS[id]} [${id}]</td>`;

      displayWeeks.forEach(week => {
        const data = (weeklyData[week] && weeklyData[week][id]) || { money: 0, items: 0 };
        const paid = type === 'money' ? data.money : data.items;
        const met = paid >= req.amount;
        const cellColor = met ? '#003300' : '#3a0000';
        const cellText = met ? '#66ff66' : '#ff6666';
        const paidLabel = type === 'money' ? `$${paid.toLocaleString()}` : `${paid} ${SETTINGS.taxItemName}`;
        const reqLabel = type === 'money' ? `$${req.amount.toLocaleString()}` : `${req.amount} ${SETTINGS.taxItemName}`;
        html += `<td style="background:${cellColor};color:${cellText};border:1px solid #444;" title="Paid ${paidLabel} / Required ${reqLabel}">${met ? '✅' : '❌'}</td>`;
      });

      const expected = allWeeks.length * req.amount;
      const balance = totalPaid - expected;
      const totalLabel = type === 'money' ? `$${totalPaid.toLocaleString()}` : `${totalPaid} ${SETTINGS.taxItemName}`;
      html += `<td style="color:#66ff66;padding:6px;border:1px solid #444;position:sticky;right:140px;background:${rowBg};">${totalLabel}</td>`;

      if (type === 'money') {
        grandMoneyPaid += totalPaid;
        grandMoneyExpected += expected;
      } else {
        grandItemPaid += totalPaid;
        grandItemExpected += expected;
      }

      if (balance < 0) {
        const owe = type === 'money' ? `$${Math.abs(balance).toLocaleString()}` : `${Math.abs(balance)} ${SETTINGS.taxItemName}`;
        html += `<td style="color:#ff6666;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">Owes ${owe}</td>`;
        owingList.push({ id, name: COMPANY_MEMBERS[id], amount: owe });
      } else if (balance > 0) {
        const over = type === 'money' ? `$${balance.toLocaleString()}` : `${balance} ${SETTINGS.taxItemName}`;
        html += `<td style="color:#66ccff;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">Overpaid ${over}</td>`;
      } else {
        html += `<td style="color:#66ff66;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">On Track</td>`;
      }

      html += '</tr>';
    });

    html += '</tbody></table></div>';

    let summaryHtml = '<div style="margin-top:12px;padding:10px;background:#222;border:1px solid #444;border-radius:6px;">';
    summaryHtml += '<strong style="color:#fff;">Summary</strong><br>';
    if (grandMoneyExpected > 0) {
      const balance = grandMoneyPaid - grandMoneyExpected;
      const balanceLabel = balance > 0 ? `Overpaid $${balance.toLocaleString()}` : balance < 0 ? `Owes $${Math.abs(balance).toLocaleString()}` : 'On Track';
      summaryHtml += `<span style="color:#ccc;">Money: Paid $${grandMoneyPaid.toLocaleString()} / Expected $${grandMoneyExpected.toLocaleString()} (${balanceLabel})</span><br>`;
    }
    if (grandItemExpected > 0) {
      const balance = grandItemPaid - grandItemExpected;
      const balanceLabel = balance > 0 ? `Overpaid ${balance} ${SETTINGS.taxItemName}` : balance < 0 ? `Owes ${Math.abs(balance)} ${SETTINGS.taxItemName}` : 'On Track';
      summaryHtml += `<span style="color:#ccc;">Items: Paid ${grandItemPaid} ${SETTINGS.taxItemName} / Expected ${grandItemExpected} ${SETTINGS.taxItemName} (${balanceLabel})</span><br>`;
    }
    summaryHtml += '</div>';

    let reminderHtml = '<div style="margin-top:12px;padding:10px;background:#222;border:1px solid #444;border-radius:6px;">';
    reminderHtml += '<h4 style="color:#fff;margin:0 0 10px 0;">Employees Owing Tax</h4>';
    if (owingList.length === 0) {
      reminderHtml += '<p style="color:lightgreen;">All employees are fully paid up ✅</p>';
    } else {
      reminderHtml += '<ul style="list-style:none;padding:0;margin:0;">';
      owingList.forEach(emp => {
        const reminderText = SETTINGS.reminderMessage
          .replace(/\{name\}/g, emp.name)
          .replace(/\{id\}/g, emp.id)
          .replace(/\{amount\}/g, emp.amount);
        reminderHtml += `<li style="margin:6px 0;color:#ff6666;">${emp.name} [${emp.id}] owes ${emp.amount}
          <a href="#" data-id="${emp.id}" data-msg="${encodeURIComponent(reminderText)}" class="tax-reminder-link" style="color:#66ccff;margin-left:10px;">Copy Reminder</a></li>`;
      });
      reminderHtml += '</ul>';
    }
    reminderHtml += '</div>';

    overviewView.innerHTML = html + summaryHtml + reminderHtml;

    overviewView.querySelectorAll('.tax-reminder-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const msg = decodeURIComponent(link.getAttribute('data-msg'));
        const empId = link.getAttribute('data-id');
        navigator.clipboard.writeText(msg).then(() => {
          alert('Reminder message copied to clipboard! Paste it in the compose box (Ctrl+V).');
          window.open(`https://www.torn.com/messages.php#/p=compose&XID=${empId}`, '_blank');
        });
      });
    });
  }

  function renderEmployeeMenu(employees) {
    if (!employeeView) return;
    if (!SETTINGS.enableEmployeeMenu) {
      employeeView.innerHTML = '<p style="color:#ccc;">Enable the employees menu in Settings to manage individual tax.</p>';
      return;
    }

    const ids = Object.keys(employees);
    if (ids.length === 0) {
      employeeView.innerHTML = '<p style="color:#ccc;">No employees available. Load data first.</p>';
      return;
    }

    const rows = ids.sort((a, b) => employees[a].localeCompare(employees[b])).map(id => {
      const stored = SETTINGS.memberRequirements[id];
      const req = getMemberRequirement(id);
      const isCustom = stored ? !stored.useDefault : false;
      const selectedMoney = req.type === 'item' ? '' : 'selected';
      const selectedItem = req.type === 'item' ? 'selected' : '';
      const disabledAttr = isCustom ? '' : 'disabled';
      return `
        <tr>
          <td style="padding:6px;border:1px solid #444;text-align:left;color:#fff;">${employees[id]} [${id}]</td>
          <td style="padding:6px;border:1px solid #444;">
            <label style="display:flex;align-items:center;gap:6px;justify-content:center;color:#ccc;">
              <input type="checkbox" data-id="${id}" class="emp-use-custom" ${isCustom ? 'checked' : ''}>
              Custom requirement
            </label>
          </td>
          <td style="padding:6px;border:1px solid #444;">
            <select data-id="${id}" class="emp-req-type" style="width:120px;background:#111;color:#0f0;border:1px solid #555;border-radius:4px;padding:4px;" ${disabledAttr}>
              <option value="money" ${selectedMoney}>Money</option>
              <option value="item" ${selectedItem}>${SETTINGS.taxItemName}</option>
            </select>
          </td>
          <td style="padding:6px;border:1px solid #444;">
            <input type="number" data-id="${id}" class="emp-req-amount" value="${req.amount}" style="width:120px;background:#111;color:#0f0;border:1px solid #555;border-radius:4px;padding:4px;" ${disabledAttr}>
          </td>
        </tr>`;
    }).join('');

    employeeView.innerHTML = `
      <div style="overflow:auto;height:calc(100% - 50px);">
        <table style="width:100%;border-collapse:collapse;background:#1b1b1b;color:#ccc;font-size:12px;">
          <thead>
            <tr style="background:#2a2a2a;color:#fff;font-weight:bold;">
              <th style="padding:8px;border:1px solid #444;text-align:left;">Employee</th>
              <th style="padding:8px;border:1px solid #444;">Custom Requirement</th>
              <th style="padding:8px;border:1px solid #444;">Type</th>
              <th style="padding:8px;border:1px solid #444;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px;text-align:right;">
        <button id="saveEmployeeRequirements" style="background:#2e8b57;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">Save Changes</button>
      </div>
    `;

    employeeView.querySelectorAll('.emp-use-custom').forEach(box => {
      box.addEventListener('change', () => {
        const id = box.getAttribute('data-id');
        const typeSelect = employeeView.querySelector(`.emp-req-type[data-id="${id}"]`);
        const amountInput = employeeView.querySelector(`.emp-req-amount[data-id="${id}"]`);
        if (box.checked) {
          if (typeSelect) {
            typeSelect.disabled = false;
            if (typeSelect.dataset.lastValue) {
              typeSelect.value = typeSelect.dataset.lastValue;
            }
          }
          if (amountInput) {
            amountInput.disabled = false;
            if (amountInput.dataset.lastValue) {
              amountInput.value = amountInput.dataset.lastValue;
            }
          }
        } else {
          const defaults = getDefaultRequirement();
          if (typeSelect) {
            typeSelect.dataset.lastValue = typeSelect.value;
            typeSelect.value = defaults.type;
            typeSelect.disabled = true;
          }
          if (amountInput) {
            amountInput.dataset.lastValue = amountInput.value;
            amountInput.value = defaults.amount;
            amountInput.disabled = true;
          }
        }
      });
    });

    const saveButton = employeeView.querySelector('#saveEmployeeRequirements');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        const types = employeeView.querySelectorAll('.emp-req-type');
        const amounts = employeeView.querySelectorAll('.emp-req-amount');
        const toggles = employeeView.querySelectorAll('.emp-use-custom');
        toggles.forEach(box => {
          const id = box.getAttribute('data-id');
          if (!box.checked) {
            const defaults = getDefaultRequirement();
            SETTINGS.memberRequirements[id] = { type: defaults.type, amount: defaults.amount, useDefault: true };
            return;
          }
          const select = Array.from(types).find(sel => sel.getAttribute('data-id') === id);
          const amountInput = Array.from(amounts).find(input => input.getAttribute('data-id') === id);
          const type = select && select.value === 'item' ? 'item' : 'money';
          const amountValue = amountInput ? parseInt(amountInput.value, 10) : NaN;
          const fallback = type === 'money' ? SETTINGS.defaultMoneyTax : SETTINGS.defaultItemTax;
          SETTINGS.memberRequirements[id] = {
            type,
            amount: isNaN(amountValue) ? fallback : amountValue,
            useDefault: false
          };
        });
        saveSettings(SETTINGS);
        renderOverview(lastWeeklyDataCache, lastEmployeesCache);
        renderEmployeeMenu(employees);
        alert('Employee requirements saved.');
      });
    }
  }

  function safe(obj, path) {
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  }

  function normalizeIdCandidate(candidate) {
    if (candidate === null || candidate === undefined) {
      return undefined;
    }
    if (typeof candidate === 'number') {
      const num = Number(candidate);
      if (!Number.isFinite(num) || num === 0) {
        return undefined;
      }
      return String(num);
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return undefined;
      }
      const bracketMatch = trimmed.match(/\[(\d+)\]/);
      if (bracketMatch && bracketMatch[1] !== '0') {
        return bracketMatch[1];
      }
      if (/^\d+$/.test(trimmed) && trimmed !== '0') {
        return trimmed;
      }
      return undefined;
    }
    if (typeof candidate === 'object') {
      const fields = ['player_id', 'playerId', 'id', 'ID', 'user_id', 'userid', 'uid'];
      for (const field of fields) {
        if (candidate[field] !== undefined) {
          const normalized = normalizeIdCandidate(candidate[field]);
          if (normalized) {
            return normalized;
          }
        }
      }
    }
    return undefined;
  }

  function buildEmployeeNameIndex(employees) {
    const index = {};
    Object.entries(employees || {}).forEach(([id, name]) => {
      if (typeof name !== 'string') {
        return;
      }
      const normalized = name.trim().toLowerCase();
      if (!normalized) {
        return;
      }
      if (!index[normalized]) {
        index[normalized] = [];
      }
      index[normalized].push(id);
    });
    return index;
  }

  function resolveEmployeeIdByNameCandidate(candidate, employees, nameIndex) {
    if (candidate === null || candidate === undefined) {
      return undefined;
    }
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return undefined;
      }
      const bracketMatch = trimmed.match(/\[(\d+)\]/);
      if (bracketMatch && employees[bracketMatch[1]]) {
        return bracketMatch[1];
      }
      const normalized = trimmed.toLowerCase();
      const matches = nameIndex[normalized];
      if (matches && matches.length > 0) {
        return matches[0];
      }
      return undefined;
    }
    if (typeof candidate === 'object') {
      const directId = normalizeIdCandidate(candidate);
      if (directId && employees[directId]) {
        return directId;
      }
      const nameFields = [
        'name', 'player_name', 'playerName', 'username',
        'user_name', 'owner_name', 'target_name', 'member_name',
        'giver_name', 'from_name', 'employee_name', 'recipient_name',
        'sender_name', 'initiator_name'
      ];
      for (const field of nameFields) {
        if (candidate[field]) {
          const match = resolveEmployeeIdByNameCandidate(candidate[field], employees, nameIndex);
          if (match) {
            return match;
          }
        }
      }
    }
    return undefined;
  }

  function findEmployeeIdFromLog(log, employees, nameIndex) {
    const possibleFields = [
      'data.sender_id', 'data.sender', 'data.sender.player_id', 'data.sender.user_id', 'data.sender.id',
      'data.initiator_id', 'data.initiator', 'data.initiator.player_id', 'data.initiator.user_id', 'data.initiator.id',
      'data.user_id', 'data.user', 'data.user.player_id', 'data.user.user_id', 'data.user.id',
      'data.owner_id', 'data.owner', 'data.owner.player_id',
      'data.from_id', 'data.from', 'data.from.player_id',
      'data.giver_id', 'data.giver', 'data.giver.player_id',
      'data.member_id', 'data.member', 'data.member.player_id',
      'data.target_id', 'data.target', 'data.target.player_id'
    ];

    for (const path of possibleFields) {
      const candidate = normalizeIdCandidate(safe(log, path));
      if (candidate && employees[candidate]) {
        return candidate;
      }
    }

    if (!nameIndex) {
      nameIndex = buildEmployeeNameIndex(employees);
    }

    const possibleNameFields = [
      'data.sender_name', 'data.sender.name', 'data.senderName', 'data.sender',
      'data.initiator_name', 'data.initiator.name', 'data.initiator',
      'data.user_name', 'data.user.name', 'data.userName', 'data.user',
      'data.owner_name', 'data.owner.name', 'data.owner',
      'data.from_name', 'data.from.name', 'data.from',
      'data.giver_name', 'data.giver.name', 'data.giver',
      'data.member_name', 'data.member.name', 'data.member',
      'data.target_name', 'data.target.name', 'data.target',
      'data.employee_name', 'data.employee.name', 'data.employee',
      'data.recipient_name', 'data.recipient.name', 'data.recipient',
      'data.name'
    ];

    for (const path of possibleNameFields) {
      const candidate = resolveEmployeeIdByNameCandidate(safe(log, path), employees, nameIndex);
      if (candidate && employees[candidate]) {
        return candidate;
      }
    }
    return undefined;
  }

  function isMoneyLog(logType) {
    return Number.isFinite(logType) && (logType === 4800 || logType === 4810);
  }

  function isItemLog(logCategory) {
    return Number.isFinite(logCategory) && logCategory === 85;
  }

  function getMoneyAmountFromLog(log) {
    const fields = ['data.money', 'data.amount', 'data.total'];
    for (const path of fields) {
      const value = safe(log, path);
      if (value !== undefined) {
        const num = Number(value);
        if (Number.isFinite(num)) {
          return num;
        }
      }
    }
    return 0;
  }

  function extractQuantity(value) {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      const match = value.match(/-?\d+(?:\.\d+)?/);
      if (match) {
        const num = Number(match[0]);
        return Number.isFinite(num) ? num : undefined;
      }
      return undefined;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  function escapeRegex(str) {
    return String(str).replace(/[[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  }

  function parseQuantityFromText(text, targetName) {
    if (typeof text !== 'string' || !targetName) {
      return undefined;
    }
    const escaped = escapeRegex(targetName);
    const regexes = [
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:x\\s*)?${escaped}`, 'i'),
      new RegExp(`${escaped}\\s*(?:x\\s*)?(\\d+(?:\\.\\d+)?)`, 'i')
    ];
    for (const regex of regexes) {
      const match = text.match(regex);
      if (match) {
        const quantity = Number(match[1]);
        if (Number.isFinite(quantity)) {
          return quantity;
        }
      }
    }
    return undefined;
  }

  function searchDataForItem(data, targetName, targetId) {
    if (!data || !targetName) {
      return 0;
    }
    const lowerTarget = targetName.toLowerCase();
    const normalizedTargetId = normalizeItemId(targetId);
    const visited = new Set();
    let subtotal = 0;

    function traverse(value) {
      if (!value) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(traverse);
        return;
      }
      if (typeof value === 'object') {
        if (visited.has(value)) {
          return;
        }
        visited.add(value);

        const names = [
          value.name, value.item, value.itemname, value.itemName, value.title,
          value.text, value.description, value.details,
          value.sent, value.received, value.note, value.message, value.summary
        ].filter(v => typeof v === 'string');

        const exactMatch = names.find(n => n.trim().toLowerCase() === lowerTarget);
        const looseMatch = exactMatch ? exactMatch : names.find(n => n.toLowerCase().includes(lowerTarget));
        const idCandidates = [value.id, value.ID, value.item_id, value.itemId, value.itemID];
        const idMatch = normalizedTargetId !== undefined && idCandidates.some(candidate => {
          const numeric = normalizeItemId(candidate);
          return numeric !== undefined && numeric === normalizedTargetId;
        });

        let matched = false;
        if (exactMatch || looseMatch || idMatch) {
          const quantityFields = [
            'quantity', 'qty', 'amount', 'q', 'count', 'number', 'total', 'item_quantity',
            'quantity_sent', 'quantity_received', 'qty_sent', 'qty_received',
            'stack', 'stack_size', 'size'
          ];
          let quantity;
          for (const field of quantityFields) {
            if (value[field] !== undefined) {
              const extracted = extractQuantity(value[field]);
              if (extracted !== undefined) {
                quantity = extracted;
                break;
              }
            }
          }
          if (quantity === undefined && (exactMatch || looseMatch)) {
            const textCandidates = names.slice();
            const textFields = [value.note, value.message, value.extra, value.summary];
            textFields.forEach(field => {
              if (typeof field === 'string') {
                textCandidates.push(field);
              }
            });
            for (const text of textCandidates) {
              const parsed = parseQuantityFromText(text, targetName);
              if (parsed !== undefined) {
                quantity = parsed;
                break;
              }
            }
          }
          if (quantity === undefined) {
            quantity = 1;
          }
          if (quantity > 0) {
            subtotal += quantity;
            matched = true;
          }
        }

        Object.values(value).forEach(child => {
          if (child && (typeof child === 'object' || Array.isArray(child))) {
            traverse(child);
          } else if (!matched && typeof child === 'string' && child.toLowerCase().includes(lowerTarget)) {
            const parsed = parseQuantityFromText(child, targetName);
            if (parsed !== undefined && parsed > 0) {
              subtotal += parsed;
            }
          }
        });
        return;
      }
      if (typeof value === 'string' && value.toLowerCase().includes(lowerTarget)) {
        const parsed = parseQuantityFromText(value, targetName);
        if (parsed !== undefined && parsed > 0) {
          subtotal += parsed;
        }
      }
    }

    traverse(data);
    return subtotal;
  }

  function getItemQuantityFromLog(log, itemName, itemId) {
    if (!itemName) {
      return 0;
    }
    const targetName = String(itemName).trim().toLowerCase();
    if (!targetName) {
      return 0;
    }

    const normalizedTargetId = normalizeItemId(itemId);

    let total = 0;

    const considerEntry = entry => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const names = [entry.name, entry.item, entry.itemname, entry.itemName, entry.title];
      const quantities = [entry.quantity, entry.qty, entry.amount, entry.q, entry.count];
      const matchedName = names.find(n => typeof n === 'string' && n.trim().toLowerCase() === targetName);
      const idCandidates = [entry.id, entry.ID, entry.item_id, entry.itemId, entry.itemID];
      const entryId = idCandidates.map(normalizeItemId).find(id => id !== undefined);
      const matchesId = normalizedTargetId !== undefined && entryId !== undefined && entryId === normalizedTargetId;
      if (!matchedName && !matchesId) {
        return;
      }
      const quantity = quantities.map(extractQuantity).find(q => q !== undefined);
      const value = quantity !== undefined ? quantity : 1;
      if (value > 0) {
        total += value;
      }
    };

    const considerNameAndQuantity = (name, quantity) => {
      if (typeof name !== 'string') {
        return;
      }
      if (name.trim().toLowerCase() !== targetName) {
        return;
      }
      const qty = extractQuantity(quantity);
      const value = qty !== undefined ? qty : 1;
      if (value > 0) {
        total += value;
      }
    };

    const singleCandidates = [
      safe(log, 'data.item'),
      safe(log, 'data.sent_item'),
      safe(log, 'data.target_item'),
      safe(log, 'data.received_item'),
      safe(log, 'data.sent'),
      safe(log, 'data.received'),
      safe(log, 'data.gift')
    ];
    singleCandidates.forEach(considerEntry);

    const arrayCandidates = [
      safe(log, 'data.items'),
      safe(log, 'data.sent_items'),
      safe(log, 'data.item_list'),
      safe(log, 'data.gifts'),
      safe(log, 'data.received_items'),
      safe(log, 'data.sentItems'),
      safe(log, 'data.receivedItems'),
      safe(log, 'data.itemlist'),
      safe(log, 'data.inventory')
    ];
    arrayCandidates.forEach(collection => {
      if (Array.isArray(collection)) {
        collection.forEach(considerEntry);
      } else if (collection && typeof collection === 'object') {
        Object.values(collection).forEach(considerEntry);
      }
    });

    const fallbackPairs = [
      { name: safe(log, 'data.name'), quantity: safe(log, 'data.quantity') ?? safe(log, 'data.qty') },
      { name: safe(log, 'data.itemname'), quantity: safe(log, 'data.amount') },
      { name: safe(log, 'data.item_name'), quantity: safe(log, 'data.item_quantity') },
      { name: safe(log, 'data.itemName'), quantity: safe(log, 'data.itemQuantity') },
      { name: safe(log, 'data.sent_item_name'), quantity: safe(log, 'data.sent_item_quantity') ?? safe(log, 'data.sent_item_qty') },
      { name: safe(log, 'data.received_item_name'), quantity: safe(log, 'data.received_item_quantity') ?? safe(log, 'data.received_item_qty') }
    ];
    fallbackPairs.forEach(pair => considerNameAndQuantity(pair.name, pair.quantity));

    const textCandidates = [
      safe(log, 'data.description'),
      safe(log, 'data.details'),
      safe(log, 'data.message'),
      safe(log, 'data.note')
    ].filter(Boolean);

    if (textCandidates.length > 0) {
      let textTotal = 0;
      textCandidates.forEach(text => {
        if (typeof text !== 'string') {
          return;
        }
        const regex = new RegExp(`(\\d+)\\s*x?\\s*${escapeRegex(itemName)}`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
          const value = Number(match[1]);
          if (Number.isFinite(value)) {
            textTotal += value;
          }
        }
      });

      if (textTotal > 0) {
        if (total === 0) {
          total = textTotal;
        } else if (textTotal > total) {
          total = textTotal;
        }
      }
    }

    if (total > 0) {
      return total;
    }

    const additional = searchDataForItem(safe(log, 'data'), targetName, normalizedTargetId);
    return additional > 0 ? additional : 0;
  }

  function generateWeekMapFrom(startYear, startWeek) {
    const map = {};
    const now = new Date();
    const [currentYear, currentWeek] = getWeekNumber(now);
    for (let year = startYear; year <= currentYear; year++) {
      const maxWeek = year === currentYear ? currentWeek : 53;
      const start = year === startYear ? startWeek : 1;
      for (let week = start; week <= maxWeek; week++) {
        map[`${year}-W${week}`] = true;
      }
    }
    return map;
  }

  function generateWeekKeys(startYear, startWeek) {
    return Object.keys(generateWeekMapFrom(startYear, startWeek));
  }

})();
