// ==UserScript==
// @name         Torn Lingerie Store Tax Tracker
// @namespace    http://tampermonkey.net/
// @version      5
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

  const STORAGE_KEY_SETTINGS = "torn_tax_settings_v3";

  const DEFAULT_SETTINGS = {
    startYear: new Date().getUTCFullYear(),
    startWeek: 40,
    requiredTax: 10000000,
    maxWeeks: 12,
    manualMode: false,
    manualMembers: {},
    apiKey: "",
    testMode: false
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
      <button id="editSettings" style="background:#444;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Settings</button>
      <button id="editEmployees" style="display:${SETTINGS.manualMode ? "inline-block" : "none"};background:#555;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Edit Employees</button>
      <button id="close-tax" style="background:#b30000;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">X</button>
    </div>
    <div id="taxTable" style="height:calc(100% - 44px);overflow:auto;padding:10px;"></div>
  `;
  document.body.appendChild(panel);

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
      <label>Weekly Tax:
        <input id="setTax" type="number" value="${SETTINGS.requiredTax}" style="width:140px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
      </label><br><br>
      <label>Max Weeks to Display:
        <input id="setMaxWeeks" type="number" value="${SETTINGS.maxWeeks}" style="width:90px;background:#111;color:#0f0;border:1px solid #555;margin-left:8px;">
      </label><br><br>
      <label><input id="manualMode" type="checkbox" ${SETTINGS.manualMode ? "checked" : ""}> Manual Employees Mode</label><br><br>
      <label><input id="testMode" type="checkbox" ${SETTINGS.testMode ? "checked" : ""}> Enable Test Mode (fake data)</label>
      <div style="text-align:right;margin-top:12px;">
        <button id="saveSet" style="background:#2e8b57;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Save</button>
        <button id="cancelSet" style="background:#555;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
      </div>
    `;
    document.body.appendChild(editor);
    editor.querySelector("#cancelSet").addEventListener("click", () => editor.remove());
    editor.querySelector("#saveSet").addEventListener("click", () => {
      SETTINGS.startYear = parseInt(editor.querySelector("#setYear").value, 10);
      SETTINGS.startWeek = parseInt(editor.querySelector("#setWeek").value, 10);
      SETTINGS.requiredTax = parseInt(editor.querySelector("#setTax").value, 10);
      SETTINGS.maxWeeks = parseInt(editor.querySelector("#setMaxWeeks").value, 10);
      SETTINGS.manualMode = editor.querySelector("#manualMode").checked;
      SETTINGS.testMode = editor.querySelector("#testMode").checked;
      saveSettings(SETTINGS);
      editor.remove();
      panel.querySelector("#editEmployees").style.display = SETTINGS.manualMode ? "inline-block" : "none";
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
    Object.keys(SETTINGS.manualMembers).forEach(id => { text += `${id}:${SETTINGS.manualMembers[id]}\n`; });

    editor.innerHTML = `
      <h3 style="margin:0 0 10px 0;">Manual Employees</h3>
      <textarea id="empInput" style="width:100%;height:220px;background:#111;color:#0f0;border:1px solid #555;">${text.trim()}</textarea>
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
      lines.forEach(line => {
        const [id, name] = line.split(":").map(x => x.trim());
        if (id && name) newList[id] = name;
      });
      SETTINGS.manualMembers = newList;
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

      const logRes = await fetch(`https://api.torn.com/user/?selections=log&log=4800,4810&key=${encodeURIComponent(SETTINGS.apiKey)}`);
      const logData = await logRes.json();
      const logs = logData.log || {};

      weeklyData = {};
      for (const id in logs) {
        const log = logs[id];
        if (log.log !== 4810) continue;
        const ts = new Date(log.timestamp * 1000);
        const [year, week] = getWeekNumber(ts);
        if (year < SETTINGS.startYear || (year === SETTINGS.startYear && week < SETTINGS.startWeek)) continue;
        const weekKey = `${year}-W${week}`;
        const senderId = log.data.sender;
        if (!employees[senderId]) continue;
        const amount = log.data.money || 0;
        if (!weeklyData[weekKey]) weeklyData[weekKey] = {};
        weeklyData[weekKey][senderId] = (weeklyData[weekKey][senderId] || 0) + amount;
      }
    }

    buildTable(weeklyData, employees);
  }

  function buildTable(weeklyData, COMPANY_MEMBERS) {
    const container = document.getElementById("taxTable");
    const allWeeks = Object.keys(weeklyData).sort();
    let displayWeeks = allWeeks.slice(-SETTINGS.maxWeeks);

    let grandPaid = 0, grandBalance = 0;
    let owingList = [];

    let html = `<div style="overflow:auto;"><table style="width:100%; border-collapse: collapse; text-align:center; font-size:12px; background:#1b1b1b; color:#ccc;">`;
    html += `<thead><tr style="background:#2a2a2a; color:#fff; font-weight:bold;">`;
    html += `<th style="padding:8px;border:1px solid #444;text-align:left;position:sticky;left:0;background:#2a2a2a;z-index:2;">Employee</th>`;
    displayWeeks.forEach(week => {
      html += `<th style="padding:8px;border:1px solid #444;">${week}</th>`;
    });
    html += `<th style="padding:8px;border:1px solid #444;position:sticky;right:140px;background:#2a2a2a;z-index:2;">Total Paid</th>`;
    html += `<th style="padding:8px;border:1px solid #444;position:sticky;right:0;background:#2a2a2a;z-index:2;">Balance</th></tr></thead><tbody>`;

    Object.keys(COMPANY_MEMBERS).forEach((id, idx) => {
      let totalPaid = 0;
      allWeeks.forEach(w => { totalPaid += (weeklyData[w] && weeklyData[w][id]) || 0; });
      let expected = allWeeks.length * SETTINGS.requiredTax;
      let balance = totalPaid - expected;

      const rowBg = (idx % 2 === 0) ? "#202020" : "#262626";
      html += `<tr style="background:${rowBg};">`;
      html += `<td style="padding:6px;border:1px solid #444;text-align:left;color:#fff;position:sticky;left:0;background:${rowBg};">${COMPANY_MEMBERS[id]} [${id}]</td>`;
      displayWeeks.forEach(week => {
        const paid = (weeklyData[week] && weeklyData[week][id]) || 0;
        html += paid < SETTINGS.requiredTax
          ? `<td style="background:#3a0000;color:#ff6666;border:1px solid #444;">❌</td>`
          : `<td style="background:#003300;color:#66ff66;border:1px solid #444;">✅</td>`;
      });
      html += `<td style="color:#66ff66;padding:6px;border:1px solid #444;position:sticky;right:140px;background:${rowBg};">$${totalPaid.toLocaleString()}</td>`;
      if (balance < 0) {
        html += `<td style="color:#ff6666;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">$${Math.abs(balance).toLocaleString()} Owed</td>`;
        owingList.push({ id, name: COMPANY_MEMBERS[id], amount: Math.abs(balance) });
      } else if (balance > 0) {
        html += `<td style="color:#66ccff;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">+$${balance.toLocaleString()} Overpaid</td>`;
      } else {
        html += `<td style="color:#66ff66;padding:6px;border:1px solid #444;position:sticky;right:0;background:${rowBg};">On Track</td>`;
      }
      html += "</tr>";

      grandPaid += totalPaid;
      grandBalance += balance;
    });

    html += `<tr style="background:#2a2a2a;font-weight:bold;">`;
    html += `<td style="padding:6px;border:1px solid #444;text-align:right;color:#fff;">TOTAL</td>`;
    html += `<td colspan="${displayWeeks.length}"></td>`;
    html += `<td style="color:#66ff66;padding:6px;border:1px solid #444;">$${grandPaid.toLocaleString()}</td>`;
    if (grandBalance < 0) {
      html += `<td style="color:#ff6666;padding:6px;border:1px solid #444;">$${Math.abs(grandBalance).toLocaleString()} Owed</td>`;
    } else if (grandBalance > 0) {
      html += `<td style="color:#66ccff;padding:6px;border:1px solid #444;">+$${grandBalance.toLocaleString()} Overpaid</td>`;
    } else {
      html += `<td style="color:#66ff66;padding:6px;border:1px solid #444;">On Track</td>`;
    }
    html += `</tr></tbody></table></div>`;

    // Reminders
    let reminderHtml = `<div style="margin-top:15px;padding:10px;background:#222;border:1px solid #444;border-radius:6px;">`;
    reminderHtml += `<h4 style="color:#fff;margin:0 0 10px 0;">Employees Owing Tax</h4>`;
    if (owingList.length === 0) {
      reminderHtml += `<p style="color:lightgreen;">All employees are fully paid up ✅</p>`;
    } else {
      reminderHtml += `<ul style="list-style:none;padding:0;margin:0;">`;
      owingList.forEach(emp => {
        reminderHtml += `<li style="margin:6px 0;color:#ff6666;">${emp.name} [${emp.id}] owes $${emp.amount.toLocaleString()}
          <a href="https://www.torn.com/messages.php#/p=compose&XID=${emp.id}" target="_blank" style="color:#66ccff;margin-left:10px;">Send Reminder</a></li>`;
      });
      reminderHtml += `</ul>`;
    }
    reminderHtml += `</div>`;

    container.innerHTML = html + reminderHtml;
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
      101: "Alice", 102: "Bob", 103: "Charlie", 104: "Diana"
    };
    const weeklyData = {};
    const now = new Date();
    const [year, currentWeek] = getWeekNumber(now);
    for (let i = SETTINGS.startWeek; i <= currentWeek; i++) {
      const weekKey = `${year}-W${i}`;
      weeklyData[weekKey] = {};
      Object.keys(employees).forEach(id => {
        const rand = Math.random();
        if (rand < 0.2) {
          weeklyData[weekKey][id] = 0; // missed
        } else if (rand < 0.9) {
          weeklyData[weekKey][id] = SETTINGS.requiredTax; // exact
        } else {
          weeklyData[weekKey][id] = SETTINGS.requiredTax * 2; // overpay
        }
      });
    }
    return { employees, weeklyData };
  }
})();
