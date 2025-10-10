// ==UserScript==
// @name         Torn Lingerie Store Tax Tracker (Money + Xanax Support)
// @namespace    https://github.com/ShiftyFurball/Torncity-userscripts
// @version      4.1
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
  Object.assign(button.style, {
    position: "fixed", top: "30%", right: "0%", zIndex: "9999",
    backgroundColor: "#2e8b57", color: "#fff", border: "none",
    padding: "6px 10px", borderRadius: "6px 0 0 6px", cursor: "pointer"
  });
  button.textContent = "Tax";
  document.body.appendChild(button);

  // Panel
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
      <button id="editSettings" style="background:#444;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Settings</button>
      <button id="editRequirements" style="background:#3c6;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Requirements</button>
      <button id="editEmployees" style="display:${SETTINGS.manualMode ? "inline-block" : "none"};background:#555;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Edit Employees</button>
      <button id="close-tax" style="background:#b30000;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">X</button>
    </div>
    <div id="taxTable" style="height:calc(100% - 44px);overflow:auto;padding:10px;"></div>
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

  // --- UI: Settings
  function showSettingsEditor() {
    const e = document.createElement("div");
    Object.assign(e.style, {
      position: "fixed", top: "14%", left: "32%", width: "36%",
      background: "#222", color: "#fff", padding: "15px", zIndex: "11000",
      borderRadius: "8px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)"
    });

    e.innerHTML = `
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

      <fieldset style="border:1px solid #444;padding:8px;">
        <legend style="padding:0 6px;color:#aaa;">Defaults for New Members</legend>
        <label>Default Money Tax:
          <input id="setDefaultMoney" type="number" value="${SETTINGS.defaultMoneyTax}" style="width:140px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
        </label><br><br>
        <label>Default Item (name):
          <input id="setItemName" type="text" value="${SETTINGS.taxItemName}" style="width:140px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
        </label><br><br>
        <label>Default Item Tax (qty):
          <input id="setDefaultItem" type="number" value="${SETTINGS.defaultItemTax}" style="width:90px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
        </label>
      </fieldset>
      <br>

      <label>Reminder Message:<br>
        <textarea id="setReminder" style="width:100%;height:80px;background:#111;color:#0f0;border:1px solid #555;margin-top:6px;">${SETTINGS.reminderMessage}</textarea>
        <small style="color:#aaa;">Use placeholders: {name}, {id}, {amount}</small>
      </label>

      <div style="text-align:right;margin-top:12px;">
        <button id="saveSet" style="background:#2e8b57;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Save</button>
        <button id="cancelSet" style="background:#555;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
      </div>
    `;
    document.body.appendChild(e);
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
      panel.querySelector("#editEmployees").style.display = SETTINGS.manualMode ? "inline-block" : "none";
      fetchData();
    });
  }

  // --- UI: Manual employees editor
  function showEmployeeEditor() {
    const editor = document.createElement("div");
    Object.assign(editor.style, {
      position: "fixed", top: "15%", left: "25%", width: "50%",
      background: "#222", color: "#fff", padding: "15px", zIndex: "11000",
      borderRadius: "8px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)"
    });

    let text = "";
    Object.keys(SETTINGS.manualMembers).forEach(id => {
      const req = SETTINGS.memberRequirements[id] || { type: "money", amount: SETTINGS.defaultMoneyTax };
      text += `${id}:${SETTINGS.manualMembers[id]}:${req.type}:${req.amount}\n`;
    });

    editor.innerHTML = `
      <h3 style="margin:0 0 10px 0;">Manual Employees (id:name:type:amount)</h3>
      <textarea id="empInput" style="width:100%;height:220px;background:#111;color:#0f0;border:1px solid #555;">${text.trim()}</textarea>
      <small style="color:#aaa;">Example: 12345:Alice:money:10000000 OR 67890:Bob:xanax:7</small>
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
    Object.assign(editor.style, {
      position: "fixed", top: "10%", left: "10%", width: "80%", height: "70%",
      background: "#222", color: "#fff", padding: "15px", zIndex: "11000",
      borderRadius: "8px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)", overflow: "auto",
      minWidth: "320px", minHeight: "240px"
    });

    const rows = Object.keys(currentEmployees || {}).sort((a,b)=>currentEmployees[a].localeCompare(currentEmployees[b]))
      .map(id => {
        const req = SETTINGS.memberRequirements[id] || { type: "money", amount: SETTINGS.defaultMoneyTax };
        return `
          <tr>
            <td style="padding:6px;border:1px solid #444;color:#fff;">${currentEmployees[id]} [${id}]</td>
            <td style="padding:6px;border:1px solid #444;">
              <select data-id="${id}" class="req-type" style="background:#111;color:#0f0;border:1px solid #555;">
                <option value="money" ${req.type==="money"?"selected":""}>Money</option>
                <option value="xanax" ${req.type==="xanax"?"selected":""}>${SETTINGS.taxItemName}</option>
              </select>
            </td>
            <td style="padding:6px;border:1px solid #444;">
              <input type="number" class="req-amount" data-id="${id}" value="${req.amount}" style="width:140px;background:#111;color:#0f0;border:1px solid #555;">
            </td>
          </tr>`;
      }).join("");

    editor.innerHTML = `
      <div id="req-drag-bar" style="cursor:move;background:#2a2a2a;color:#fff;padding:6px 10px;margin:-15px -15px 10px -15px;border-radius:8px 8px 0 0;border-bottom:1px solid #444;font-weight:bold;">Member Requirements</div>
      <div style="margin-bottom:6px;color:#aaa;">Item name shown as "${SETTINGS.taxItemName}" (change in Settings)</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#2a2a2a;">
            <th style="padding:6px;border:1px solid #444;text-align:left;">Member</th>
            <th style="padding:6px;border:1px solid #444;">Type</th>
            <th style="padding:6px;border:1px solid #444;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows || "<tr><td colspan='3' style='padding:10px;color:#aaa;border:1px solid #444;'>No employees loaded yet.</td></tr>"}
        </tbody>
      </table>
      <div style="text-align:right;margin-top:12px;">
        <button id="saveReqs" style="background:#2e8b57;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Save</button>
        <button id="cancelReqs" style="background:#555;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
      </div>
    `;
    document.body.appendChild(editor);

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

    let html = `<div style="overflow:auto;"><table style="width:100%; border-collapse: collapse; text-align:center; font-size:12px; background:#1b1b1b; color:#ccc;">`;
    html += `<thead><tr style="background:#2a2a2a; color:#fff; font-weight:bold;">`;
    html += `<th style="padding:8px;border:1px solid #444;text-align:left;position:sticky;left:0;background:#2a2a2a;z-index:2;">Employee</th>`;
    displayWeeks.forEach(week => {
      html += `<th style="padding:8px;border:1px solid #444;">${week}</th>`;
    });
    html += `<th style="padding:8px;border:1px solid #444;position:sticky;right:0;background:#2a2a2a;z-index:2;">Balance</th></tr></thead><tbody>`;

    const owingList = [];

    Object.keys(COMPANY_MEMBERS).forEach((id, idx) => {
      const req = SETTINGS.memberRequirements[id] || { type: "money", amount: SETTINGS.defaultMoneyTax };
      const rowBg = (idx % 2 === 0) ? "#202020" : "#262626";
      html += `<tr style="background:${rowBg};">`;
      html += `<td style="padding:6px;border:1px solid #444;text-align:left;color:#fff;position:sticky;left:0;background:${rowBg};">${COMPANY_MEMBERS[id]} [${id}]</td>`;

      let totalPaid = 0;
      displayWeeks.forEach(week => {
        const wk = weeklyData[week] && weeklyData[week][id] ? weeklyData[week][id] : { money: 0, items: 0 };
        const paid = (req.type === "money") ? wk.money : wk.items;
        totalPaid += paid;
        html += paid >= req.amount
          ? `<td style="background:#003300;color:#66ff66;border:1px solid #444;">✅</td>`
          : `<td style="background:#3a0000;color:#ff6666;border:1px solid #444;">❌</td>`;
      });

      const expected = displayWeeks.length * req.amount;
      const balance = totalPaid - expected;

      if (balance < 0) {
        html += `<td style="color:#ff6666;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">Owes ${req.type === "money" ? "$" + Math.abs(balance).toLocaleString() : Math.abs(balance) + " " + SETTINGS.taxItemName}</td>`;
        owingList.push({ id, name: COMPANY_MEMBERS[id], amount: req.type === "money" ? "$" + Math.abs(balance).toLocaleString() : Math.abs(balance) + " " + SETTINGS.taxItemName });
      } else if (balance > 0) {
        html += `<td style="color:#66ccff;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">Overpaid ${req.type === "money" ? "$" + balance.toLocaleString() : balance + " " + SETTINGS.taxItemName}</td>`;
      } else {
        html += `<td style="color:#66ff66;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">On Track</td>`;
      }

      html += `</tr>`;
    });

    html += `</tbody></table></div>`;

    // Reminders box
    let reminderHtml = `<div style="margin-top:15px;padding:10px;background:#222;border:1px solid #444;border-radius:6px;">`;
    reminderHtml += `<h4 style="color:#fff;margin:0 0 10px 0;">Employees Owing Tax</h4>`;
    if (owingList.length === 0) {
      reminderHtml += `<p style="color:lightgreen;">All employees are fully paid up ✅</p>`;
    } else {
      reminderHtml += `<ul style="list-style:none;padding:0;margin:0;">`;
      owingList.forEach(emp => {
        const msg = SETTINGS.reminderMessage
          .replace(/{name}/g, emp.name)
          .replace(/{id}/g, emp.id)
          .replace(/{amount}/g, emp.amount);
        reminderHtml += `<li style="margin:6px 0;color:#ff6666;">
          ${emp.name} [${emp.id}] owes ${emp.amount}
          <a href="#" data-id="${emp.id}" data-msg="${encodeURIComponent(msg)}"
             class="send-reminder" style="color:#66ccff;margin-left:10px;">Send Reminder</a></li>`;
      });
      reminderHtml += `</ul>`;
    }
    reminderHtml += `</div>`;

    container.innerHTML = html + reminderHtml;

    // Clipboard reminder handlers
    container.querySelectorAll(".send-reminder").forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        const empId = link.getAttribute("data-id");
        const msg = decodeURIComponent(link.getAttribute("data-msg"));
        navigator.clipboard.writeText(msg).then(() => {
          alert("Reminder message copied to clipboard! Paste it in the compose box (Ctrl+V).");
          window.open(`https://www.torn.com/messages.php#/p=compose&XID=${empId}`, "_blank");
        });
      });
    });
  }

  // --- Helpers

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
