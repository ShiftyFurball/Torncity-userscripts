// ==UserScript==
// @name         Torn Lingerie Store Tax Tracker
// @namespace    http://tampermonkey.net/
// @version      8.0.0-beta.14
// @description  Cached staff payment tracking for an adjustable period, with cash/item payments checked against previous arrears before future credit.
// @author       Hooded_Prince
// @match        https://www.torn.com/*
// @grant        none
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/ShiftyFurball/Torncity-userscripts/codex/simple-eight-week-tracker/torn-tax-tracker.user.js
// @updateURL https://raw.githubusercontent.com/ShiftyFurball/Torncity-userscripts/codex/simple-eight-week-tracker/torn-tax-tracker.user.js
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY_SETTINGS_PREFIX = "torn_tax_settings_v5";
  const STORAGE_KEY_PROFILE_META = "torn_tax_profile_meta_v1";
  const STORAGE_KEY_ITEM_CATALOG = "torn_tax_item_catalog_v1";
  const DEFAULT_PROFILE_ID = "default";
  const ITEM_CATALOG_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  const DEFAULT_TAX_ITEM_ID = 206;
  const ROLLING_WINDOW_WEEKS = 8;
  const MILLIS_PER_DAY = 86400000;
  const MILLIS_PER_WEEK = 7 * MILLIS_PER_DAY;
  let apiRequestQueue = Promise.resolve();
  let nextApiRequestAt = 0;
  let apiCooldownUntil = 0;

  const DEFAULT_SETTINGS = {
    startYear: new Date().getUTCFullYear(),
    startWeek: 40,
    maxWeeks: ROLLING_WINDOW_WEEKS,
    maxLogPages: 25,
    manualMode: false,
    manualMembers: {},
    apiKey: "",
    testMode: false,
    // Per-member overrides
    memberRequirements: {},
    memberRequirementResets: {},
    memberWeekExclusions: {},
    memberWeekCarrybacks: {},
    defaultRequirementReset: null,
    defaultMoneyTax: 10000000,
    defaultItemTax: 7,
    defaultRequirementType: "money",
    paymentDueWeekday: 0,
    allowPrepaymentRollover: true,
    taxItemName: "Xanax",
    reminderMessage: "Hi {name}, you currently owe {amount}. Please pay as soon as possible. Thanks!",
    excludedPayments: {},
    enableEmployeeMenu: false,
    // Legacy field kept for backwards compatibility with older saves
    requiredTax: 10000000
  };

  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function sanitizeProfileId(id) {
    const fallback = DEFAULT_PROFILE_ID;
    if (typeof id !== "string") {
      return fallback;
    }
    const cleaned = id.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || fallback;
  }

  function getSettingsStorageKey(profileId) {
    return `${STORAGE_KEY_SETTINGS_PREFIX}_${sanitizeProfileId(profileId)}`;
  }

  function loadProfileMeta() {
    const fallback = { activeProfileId: DEFAULT_PROFILE_ID, knownProfileIds: [DEFAULT_PROFILE_ID] };
    const saved = localStorage.getItem(STORAGE_KEY_PROFILE_META);
    if (!saved) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(saved);
      const known = Array.isArray(parsed.knownProfileIds) ? parsed.knownProfileIds.map(sanitizeProfileId).filter(Boolean) : [];
      const uniqueKnown = Array.from(new Set([DEFAULT_PROFILE_ID, ...known]));
      return {
        activeProfileId: sanitizeProfileId(parsed.activeProfileId),
        knownProfileIds: uniqueKnown
      };
    } catch (err) {
      console.warn("Failed to parse profile metadata, resetting to defaults.", err);
      return fallback;
    }
  }

  function saveProfileMeta(meta) {
    const normalized = {
      activeProfileId: sanitizeProfileId(meta && meta.activeProfileId),
      knownProfileIds: Array.from(new Set([DEFAULT_PROFILE_ID].concat(Array.isArray(meta && meta.knownProfileIds) ? meta.knownProfileIds.map(sanitizeProfileId) : [])))
    };
    localStorage.setItem(STORAGE_KEY_PROFILE_META, JSON.stringify(normalized));
  }

  function loadSettings(profileId) {
    const saved = localStorage.getItem(getSettingsStorageKey(profileId));
    if (!saved) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
    try {
      const parsed = JSON.parse(saved);
      return Object.assign({}, DEFAULT_SETTINGS, parsed);
    } catch (err) {
      console.warn("Failed to parse saved settings, resetting to defaults.", err);
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }
  function saveSettings(s) {
    if (!PROFILE_META.knownProfileIds.includes(ACTIVE_PROFILE_ID)) {
      PROFILE_META.knownProfileIds.push(ACTIVE_PROFILE_ID);
      saveProfileMeta(PROFILE_META);
    }
    localStorage.setItem(getSettingsStorageKey(ACTIVE_PROFILE_ID), JSON.stringify(s));
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

  function normalizeEmployeeRecord(record) {
    if (!record) {
      return { name: "", joinDays: null, joinDate: null };
    }
    if (typeof record === "string") {
      return { name: record, joinDays: null, joinDate: null };
    }
    if (typeof record === "object") {
      const name = typeof record.name === "string" ? record.name : "";
      const joinDaysValue = record.joinDays == null ? NaN : Number(record.joinDays);
      const joinDateValue = Number(record.joinDate);
      return {
        name,
        joinDays: Number.isFinite(joinDaysValue) ? joinDaysValue : null,
        joinDate: Number.isFinite(joinDateValue) && joinDateValue > 0 ? joinDateValue : null
      };
    }
    return { name: "", joinDays: null, joinDate: null };
  }

  function normalizeEmployeeMap(map) {
    const normalized = {};
    Object.keys(map || {}).forEach(id => {
      normalized[id] = normalizeEmployeeRecord(map[id]);
    });
    return normalized;
  }

  function parseWeekKey(key) {
    if (typeof key !== "string") {
      return null;
    }
    const match = key.match(/^(\d+)-W(\d+)$/);
    if (!match) {
      return null;
    }
    return [parseInt(match[1], 10), parseInt(match[2], 10)];
  }

  function compareWeekKeys(a, b) {
    const pa = parseWeekKey(a);
    const pb = parseWeekKey(b);
    if (!pa && !pb) {
      return 0;
    }
    if (!pa) {
      return -1;
    }
    if (!pb) {
      return 1;
    }
    if (pa[0] !== pb[0]) {
      return pa[0] - pb[0];
    }
    return pa[1] - pb[1];
  }

  function formatWeekKey(year, week) {
    return `${Number(year)}-W${String(Number(week)).padStart(2, '0')}`;
  }

  function isWeekOnOrAfter(candidate, baseline) {
    const cand = parseWeekKey(candidate);
    const base = parseWeekKey(baseline);
    if (!cand || !base) {
      return false;
    }
    if (cand[0] > base[0]) {
      return true;
    }
    if (cand[0] < base[0]) {
      return false;
    }
    return cand[1] >= base[1];
  }

  function getCurrentWeekKey() {
    const now = new Date();
    const [year, week] = getWeekNumber(now);
    return `${year}-W${week}`;
  }

  function getEmployeeName(record) {
    if (!record) {
      return "";
    }
    if (typeof record === "string") {
      return record;
    }
    if (typeof record === "object" && record !== null) {
      return typeof record.name === "string" ? record.name : "";
    }
    return "";
  }

  function getEmployeeJoinTimestamp(record) {
    if (!record || typeof record !== "object") {
      return null;
    }
    const ts = Number(record.joinDate);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
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
      const data = await tornFetch('torn/', {selections:'items'});
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
      if (err.apiAuthFailure || err.apiCooldown) throw err;
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

  let PROFILE_META = loadProfileMeta();
  let ACTIVE_PROFILE_ID = sanitizeProfileId(PROFILE_META.activeProfileId);
  PROFILE_META.activeProfileId = ACTIVE_PROFILE_ID;
  if (!PROFILE_META.knownProfileIds.includes(ACTIVE_PROFILE_ID)) {
    PROFILE_META.knownProfileIds.push(ACTIVE_PROFILE_ID);
  }
  saveProfileMeta(PROFILE_META);
  let SETTINGS = loadSettings(ACTIVE_PROFILE_ID);
  window.addEventListener('storage', event => {
    if (event.key !== getSettingsStorageKey(ACTIVE_PROFILE_ID)) return;
    try { if (JSON.parse(event.newValue || '{}').apiKey === '') SETTINGS.apiKey = ''; } catch { /* Ignore malformed unrelated updates. */ }
  });

  function ensureSettingsShapeInPlace() {
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
    if (!SETTINGS.maxLogPages) {
      SETTINGS.maxLogPages = DEFAULT_SETTINGS.maxLogPages;
    }
    if (SETTINGS.defaultRequirementType !== "item" && SETTINGS.defaultRequirementType !== "money") {
      SETTINGS.defaultRequirementType = DEFAULT_SETTINGS.defaultRequirementType;
    }
    if (!Number.isInteger(SETTINGS.paymentDueWeekday) || SETTINGS.paymentDueWeekday < 0 || SETTINGS.paymentDueWeekday > 6) {
      SETTINGS.paymentDueWeekday = DEFAULT_SETTINGS.paymentDueWeekday;
    }
    if (!SETTINGS.memberRequirementResets || typeof SETTINGS.memberRequirementResets !== "object") {
      SETTINGS.memberRequirementResets = {};
    }
    if (!SETTINGS.memberWeekExclusions || typeof SETTINGS.memberWeekExclusions !== "object") {
      SETTINGS.memberWeekExclusions = {};
    }
    if (!SETTINGS.memberWeekCarrybacks || typeof SETTINGS.memberWeekCarrybacks !== "object") {
      SETTINGS.memberWeekCarrybacks = {};
    }
    if (!SETTINGS.excludedPayments || typeof SETTINGS.excludedPayments !== "object") {
      SETTINGS.excludedPayments = {};
    }
    if (typeof SETTINGS.defaultRequirementReset !== "string") {
      SETTINGS.defaultRequirementReset = `${SETTINGS.startYear}-W${SETTINGS.startWeek}`;
    }
  }

  ensureSettingsShapeInPlace();

  function sanitizeSettingsInPlace() {
    const parsedYear = parseInt(SETTINGS.startYear, 10);
    const parsedWeek = parseInt(SETTINGS.startWeek, 10);
    const parsedMaxWeeks = parseInt(SETTINGS.maxWeeks, 10);
    const parsedMaxLogPages = parseInt(SETTINGS.maxLogPages, 10);
    SETTINGS.startYear = Number.isFinite(parsedYear) && parsedYear >= 2000 ? parsedYear : DEFAULT_SETTINGS.startYear;
    SETTINGS.startWeek = Number.isFinite(parsedWeek) ? Math.min(53, Math.max(1, parsedWeek)) : DEFAULT_SETTINGS.startWeek;
    SETTINGS.maxWeeks = Number.isFinite(parsedMaxWeeks) ? Math.min(52, Math.max(1, parsedMaxWeeks)) : DEFAULT_SETTINGS.maxWeeks;
    SETTINGS.maxLogPages = Number.isFinite(parsedMaxLogPages) ? Math.min(100, Math.max(1, parsedMaxLogPages)) : DEFAULT_SETTINGS.maxLogPages;
    const parsedDueWeekday = parseInt(SETTINGS.paymentDueWeekday, 10);
    SETTINGS.paymentDueWeekday = Number.isFinite(parsedDueWeekday) ? Math.min(6, Math.max(0, parsedDueWeekday)) : DEFAULT_SETTINGS.paymentDueWeekday;
  }

  sanitizeSettingsInPlace();

  function switchToProfile(profileId) {
    const nextProfileId = sanitizeProfileId(profileId);
    ACTIVE_PROFILE_ID = nextProfileId;
    PROFILE_META.activeProfileId = nextProfileId;
    if (!PROFILE_META.knownProfileIds.includes(nextProfileId)) {
      PROFILE_META.knownProfileIds.push(nextProfileId);
    }
    saveProfileMeta(PROFILE_META);
    SETTINGS = loadSettings(nextProfileId);
    ensureSettingsShapeInPlace();
    sanitizeSettingsInPlace();
  }

  let scanComplete = false;
  let reminderDraftTimer = null;
  let fetching = false;
  let lastEmployeesCache = {};
  let lastWeeklyDataCache = {};
  let lastPaymentHistoryCache = {};

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

  function getMemberTaxRequirements(id) {
    const req = getMemberRequirement(id);
    const cashRequired = req.type === 'money' && !req.isDefault ? req.amount : SETTINGS.defaultMoneyTax;
    const itemRequired = req.type === 'item' && !req.isDefault ? req.amount : SETTINGS.defaultItemTax;
    return {
      cash: Math.max(1, Number(cashRequired) || DEFAULT_SETTINGS.defaultMoneyTax),
      items: Math.max(1, Number(itemRequired) || DEFAULT_SETTINGS.defaultItemTax),
      display: req
    };
  }

  function getRequirementStartWeek(id, requirement) {
    if (SETTINGS.memberRequirementResets && typeof SETTINGS.memberRequirementResets[id] === "string") {
      return SETTINGS.memberRequirementResets[id];
    }
    if (requirement && requirement.isDefault && typeof SETTINGS.defaultRequirementReset === "string") {
      return SETTINGS.defaultRequirementReset;
    }
    return `${SETTINGS.startYear}-W${SETTINGS.startWeek}`;
  }

  function ensureExcludedPaymentsContainer() {
    if (!SETTINGS.excludedPayments || typeof SETTINGS.excludedPayments !== "object") {
      SETTINGS.excludedPayments = {};
    }
    return SETTINGS.excludedPayments;
  }

  function isPaymentExcluded(employeeId, paymentId) {
    if (!employeeId || !paymentId) {
      return false;
    }
    const container = ensureExcludedPaymentsContainer();
    if (!container[employeeId] || typeof container[employeeId] !== "object") {
      return false;
    }
    if (container[employeeId][paymentId]) {
      return true;
    }
    const bareId = String(paymentId).replace(/^(money|cash|item|xanax):/, '');
    return !!container[employeeId][bareId];
  }

  function setPaymentExcluded(employeeId, paymentId, excluded) {
    if (!employeeId || !paymentId) {
      return;
    }
    const container = ensureExcludedPaymentsContainer();
    if (!container[employeeId] || typeof container[employeeId] !== "object") {
      container[employeeId] = {};
    }
    if (excluded) {
      container[employeeId][paymentId] = true;
    } else {
      delete container[employeeId][paymentId];
      if (Object.keys(container[employeeId]).length === 0) {
        delete container[employeeId];
      }
    }
  }

  function applyPaymentExclusion(employeeId, paymentId, excluded) {
    if (!employeeId || !paymentId) {
      return;
    }
    if (!lastPaymentHistoryCache || !lastWeeklyDataCache) {
      return;
    }
    const entries = lastPaymentHistoryCache[employeeId];
    if (!Array.isArray(entries)) {
      return;
    }
    const targetId = String(paymentId);
    const entry = entries.find(item => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const entryId = item.id || item.logId;
      if (entryId !== undefined && entryId !== null) {
        return String(entryId) === targetId;
      }
      return false;
    });
    if (!entry) {
      return;
    }
    const alreadyExcluded = !!entry.excluded;
    if (alreadyExcluded === excluded) {
      return;
    }
    entry.excluded = excluded;
    const weekKey = entry.weekKey;
    if (!weekKey) {
      refreshViewsAfterPaymentChange();
      return;
    }
    if (!lastWeeklyDataCache[weekKey]) {
      lastWeeklyDataCache[weekKey] = {};
    }
    if (!lastWeeklyDataCache[weekKey][employeeId]) {
      lastWeeklyDataCache[weekKey][employeeId] = { money: 0, items: 0 };
    }
    const bucket = lastWeeklyDataCache[weekKey][employeeId];
    const amount = Number(entry.amount) || 0;
    if (amount > 0) {
      if (entry.type === 'money') {
        const nextValue = (Number(bucket.money) || 0) + (excluded ? -amount : amount);
        bucket.money = Math.max(0, nextValue);
      } else if (entry.type === 'item') {
        const nextValue = (Number(bucket.items) || 0) + (excluded ? -amount : amount);
        bucket.items = Math.max(0, nextValue);
      }
    }
    refreshViewsAfterPaymentChange();
  }

  function refreshViewsAfterPaymentChange() {
    const employees = lastEmployeesCache || {};
    renderOverview(lastWeeklyDataCache, employees);
    if (SETTINGS.enableEmployeeMenu) {
      renderEmployeeMenu(employees);
    }
    renderPaymentHistory(lastPaymentHistoryCache, employees);
  }

  function syncExcludedPaymentsWithWeeklyData(paymentHistory, weeklyData) {
    if (!paymentHistory || typeof paymentHistory !== 'object' || !weeklyData || typeof weeklyData !== 'object') {
      return;
    }
    Object.keys(paymentHistory).forEach(employeeId => {
      const entries = paymentHistory[employeeId];
      if (!Array.isArray(entries)) {
        return;
      }
      entries.forEach(entry => {
        if (!entry || !entry.excluded) {
          return;
        }
        const weekKey = entry.weekKey;
        if (!weekKey) {
          return;
        }
        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = {};
        }
        if (!weeklyData[weekKey][employeeId]) {
          weeklyData[weekKey][employeeId] = { money: 0, items: 0 };
        }
        const bucket = weeklyData[weekKey][employeeId];
        const amount = Number(entry.amount) || 0;
        if (entry.type === 'money') {
          bucket.money = Math.max(0, (Number(bucket.money) || 0) - amount);
        } else if (entry.type === 'item') {
          bucket.items = Math.max(0, (Number(bucket.items) || 0) - amount);
        }
      });
    });
  }

  function getExcludedWeeksForMember(id) {
    if (!SETTINGS.memberWeekExclusions) {
      return [];
    }
    const exclusions = SETTINGS.memberWeekExclusions[id];
    if (!Array.isArray(exclusions)) {
      return [];
    }
    return exclusions.filter(week => typeof week === "string");
  }

  function setExcludedWeeksForMember(id, weeks) {
    if (!SETTINGS.memberWeekExclusions) {
      SETTINGS.memberWeekExclusions = {};
    }
    if (!weeks || weeks.length === 0) {
      delete SETTINGS.memberWeekExclusions[id];
      return;
    }
    const unique = Array.from(new Set(weeks.filter(week => typeof week === "string")));
    unique.sort(compareWeekKeys);
    SETTINGS.memberWeekExclusions[id] = unique;
  }

  function toggleWeekExclusionForMember(id, weekKey) {
    if (!id || !weekKey || !parseWeekKey(weekKey)) {
      return;
    }
    const existing = new Set(getExcludedWeeksForMember(id));
    if (existing.has(weekKey)) {
      existing.delete(weekKey);
    } else {
      existing.add(weekKey);
    }
    setExcludedWeeksForMember(id, Array.from(existing));
    saveSettings(SETTINGS);
  }

  function getWeekCarrybacksForMember(id) {
    if (!SETTINGS.memberWeekCarrybacks) {
      SETTINGS.memberWeekCarrybacks = {};
    }
    const raw = SETTINGS.memberWeekCarrybacks[id];
    if (!raw || typeof raw !== "object") {
      return {};
    }
    const valid = {};
    Object.keys(raw).forEach(weekKey => {
      const target = raw[weekKey];
      if (typeof weekKey === "string" && typeof target === "string" && parseWeekKey(weekKey) && parseWeekKey(target)) {
        valid[weekKey] = target;
      }
    });
    return valid;
  }

  function setWeekCarrybacksForMember(id, mapping) {
    if (!SETTINGS.memberWeekCarrybacks) {
      SETTINGS.memberWeekCarrybacks = {};
    }
    if (!mapping || Object.keys(mapping).length === 0) {
      delete SETTINGS.memberWeekCarrybacks[id];
      return;
    }
    const sanitized = {};
    Object.keys(mapping).forEach(weekKey => {
      const target = mapping[weekKey];
      if (typeof weekKey === "string" && typeof target === "string" && parseWeekKey(weekKey) && parseWeekKey(target)) {
        sanitized[weekKey] = target;
      }
    });
    if (Object.keys(sanitized).length === 0) {
      delete SETTINGS.memberWeekCarrybacks[id];
      return;
    }
    SETTINGS.memberWeekCarrybacks[id] = sanitized;
  }

  function updateWeekCarrybackForMember(id, weekKey, targetWeek) {
    if (!id || !weekKey || !parseWeekKey(weekKey)) {
      return;
    }
    const existing = getWeekCarrybacksForMember(id);
    if (!targetWeek || !parseWeekKey(targetWeek)) {
      delete existing[weekKey];
    } else {
      existing[weekKey] = targetWeek;
    }
    setWeekCarrybacksForMember(id, existing);
    saveSettings(SETTINGS);
  }

  const LAYER_Z_INDEX = {
    floatingButton: 2147483644,
    panel: 2147483645,
    modal: 2147483646,
    active: 2147483647
  };

  function bringToFront(el) {
    if (!el) {
      return;
    }
    el.style.zIndex = String(el.id === 'tax-panel' ? LAYER_Z_INDEX.panel : LAYER_Z_INDEX.modal);
  }

  // Floating open button
  const button = document.createElement("button");
  Object.assign(button.style, {
    position: "fixed", top: "30%", right: "0%", zIndex: String(LAYER_Z_INDEX.floatingButton),
    backgroundColor: "#2e8b57", color: "#fff", border: "none",
    padding: "6px 10px", borderRadius: "6px 0 0 6px", cursor: "pointer"
  });
  button.textContent = "Tax";
  button.title = "Open tax tracker (Alt+T)";
  button.setAttribute("aria-label", "Open tax tracker");
  document.body.appendChild(button);

  // Panel shell
  const panel = document.createElement("div");
  panel.id = "tax-panel";
  Object.assign(panel.style, {
    display: "none", position: "fixed", top: "10%", left: "10%",
    width: "80%", height: "75%", background: "#1b1b1b", color: "#ccc",
    padding: "0", zIndex: String(LAYER_Z_INDEX.panel), borderRadius: "6px", overflow: "hidden", flexDirection: "column",
    boxShadow: "0px 0px 15px rgba(0,0,0,0.7)", border: "1px solid #333",
    fontFamily: "'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', 'Apple Color Emoji', Verdana, sans-serif"
  });

  panel.innerHTML = `
    <div id="drag-bar" style="cursor:move;background:#2a2a2a;color:#fff;padding:6px 10px;border-bottom:1px solid #444;display:flex;align-items:center;gap:8px;">
      <span style="font-weight:bold;flex:1;">Weekly Tax Tracker</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <button id="openOverview" style="background:#2e8b57;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Overview</button>
        <button id="openPayments" style="background:#444;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Payments</button>
        <button id="openEmployeeMenu" style="display:${SETTINGS.enableEmployeeMenu ? "inline-block" : "none"};background:#444;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Employees</button>
        <button id="refreshTaxData" style="background:#1e4f75;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Refresh</button>
        <button id="editSettings" style="background:#444;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Settings</button>
        <button id="editEmployees" style="display:${SETTINGS.manualMode ? "inline-block" : "none"};background:#555;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">Edit Employees</button>
        <button id="close-tax" style="background:#b30000;color:white;border:none;padding:4px 8px;cursor:pointer;border-radius:4px;">X</button>
      </div>
    </div>
    <div id="tax-status" style="display:none;padding:6px 10px;border-bottom:1px solid #2d2d2d;font-size:12px;color:#e0e0e0;background:#191919;"></div>
    <div id="viewContainer" style="flex:1;min-height:0;">
      <div id="overviewView" style="height:100%;overflow:auto;padding:10px;"></div>
      <div id="paymentsView" style="display:none;height:100%;overflow:auto;padding:10px;"></div>
      <div id="employeeView" style="display:none;height:100%;overflow:auto;padding:10px;"></div>
    </div>
  `;
  document.body.appendChild(panel);
  // The browser top layer keeps the tracker above Torn's sticky header.
  if (typeof panel.showPopover === 'function') panel.setAttribute('popover', 'manual');
  Object.assign(panel.style, {margin:'0', right:'auto', bottom:'auto', boxSizing:'border-box', maxWidth:'calc(100vw - 24px)', maxHeight:'calc(100dvh - 24px)'});
  panel.querySelector('#drag-bar').style.flexShrink = '0';
  panel.querySelector('#drag-bar').style.flexWrap = 'wrap';
  panel.querySelector('#tax-status').style.flexShrink = '0';
  panel.querySelector('#viewContainer').style.overflow = 'hidden';
  for (const view of panel.querySelectorAll('#overviewView, #paymentsView, #employeeView')) {
    Object.assign(view.style, {boxSizing:'border-box', overscrollBehavior:'contain'});
  }
  function openTracker() {
    panel.style.display = 'flex';
    if (panel.hasAttribute('popover') && !panel.matches(':popover-open')) panel.showPopover();
  }
  function closeTracker() {
    if (panel.hasAttribute('popover') && panel.matches(':popover-open')) panel.hidePopover();
    panel.style.display = 'none';
  }

  const overviewView = panel.querySelector("#overviewView");
  const paymentsView = panel.querySelector("#paymentsView");
  const employeeView = panel.querySelector("#employeeView");
  const overviewButton = panel.querySelector("#openOverview");
  const paymentsButton = panel.querySelector("#openPayments");
  const employeeButton = panel.querySelector("#openEmployeeMenu");
  const refreshButton = panel.querySelector("#refreshTaxData");
  const statusBanner = panel.querySelector("#tax-status");
  let currentView = "overview";

  function setStatus(message, kind = "info") {
    if (!statusBanner) {
      return;
    }
    if (!message) {
      statusBanner.style.display = "none";
      statusBanner.textContent = "";
      return;
    }
    const palette = {
      info: { bg: "#191919", color: "#e0e0e0", border: "#2d2d2d" },
      success: { bg: "#17341f", color: "#98f0b5", border: "#1f5a32" },
      error: { bg: "#3c1a1a", color: "#ffb6b6", border: "#6a2626" }
    };
    const selected = palette[kind] || palette.info;
    statusBanner.style.display = "block";
    statusBanner.style.background = selected.bg;
    statusBanner.style.color = selected.color;
    statusBanner.style.borderBottomColor = selected.border;
    statusBanner.textContent = message;
  }

  function switchView(view) {
    if (view === "employees" && !SETTINGS.enableEmployeeMenu) {
      view = "overview";
    }
    currentView = view;

    if (overviewView) {
      overviewView.style.display = view === "overview" ? "block" : "none";
    }
    if (paymentsView) {
      paymentsView.style.display = view === "payments" ? "block" : "none";
      if (view !== "payments") {
        paymentsView.scrollTop = 0;
      }
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
    if (paymentsButton) {
      paymentsButton.style.background = view === "payments" ? "#2e8b57" : "#444";
      paymentsButton.style.color = "white";
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
    bringToFront(panel);
    openTracker();
    fetchData();
  });
  document.addEventListener("keydown", event => {
    if (!event.altKey || event.repeat) {
      return;
    }
    if ((event.key || "").toLowerCase() !== "t") {
      return;
    }
    const targetTag = (event.target && event.target.tagName ? event.target.tagName : "").toLowerCase();
    if (targetTag === "input" || targetTag === "textarea" || targetTag === "select") {
      return;
    }
    event.preventDefault();
    if (panel.style.display === "flex") {
      closeTracker();
      return;
    }
    if (!SETTINGS.apiKey && !SETTINGS.testMode) {
      showApiPrompt();
      return;
    }
    bringToFront(panel);
    openTracker();
    fetchData();
  });
  panel.querySelector("#close-tax").addEventListener("click", closeTracker);
  panel.querySelector("#editEmployees").addEventListener("click", () => showEmployeeEditor());
  panel.querySelector("#editSettings").addEventListener("click", () => showSettingsEditor());
  overviewButton.addEventListener("click", () => {
    switchView("overview");
    if (Object.keys(lastWeeklyDataCache).length === 0) {
      fetchData();
    }
  });
  if (paymentsButton) {
    paymentsButton.addEventListener("click", () => {
      switchView("payments");
      if (Object.keys(lastWeeklyDataCache).length === 0 && Object.keys(lastPaymentHistoryCache).length === 0) {
        fetchData();
      } else {
        renderPaymentHistory(lastPaymentHistoryCache, lastEmployeesCache);
      }
    });
  }
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
  if (refreshButton) {
    refreshButton.addEventListener("click", () => fetchData(true));
  }
  panel.addEventListener("mousedown", () => bringToFront(panel));

  for (const id of ['openOverview', 'openPayments', 'openEmployeeMenu', 'editEmployees']) {
    panel.querySelector('#' + id).hidden = true;
    panel.querySelector('#' + id).style.display = 'none';
  }
  panel.querySelector('#drag-bar span').textContent = 'Staff payments';
  switchView("overview");
  installPaymentReminderDraft();
  window.addEventListener('hashchange', installPaymentReminderDraft);

  function showApiPrompt() {
    if (document.getElementById('tax-api-prompt')) return;
    const editor = document.createElement("dialog");
    editor.id = 'tax-api-prompt';
    Object.assign(editor.style, {
      position: "fixed", top: "30%", left: "35%", width: "30%",
      background: "#222", color: "#fff", padding: "15px", zIndex: String(LAYER_Z_INDEX.modal),
      borderRadius: "6px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)"
    });
    editor.innerHTML = `
      <h3 style="margin:0 0 10px 0;">Enter Torn API Key</h3>
      <p>Full Access API key required for cash payment logs. A custom key with access to the required cash/item logs also works. Limited Access cannot read these logs.</p>
      <p>Your key is stored in this browser and sent only to Torn's API.</p>
      ${apiUsageDisclosure()}
      <input id="apiInput" type="password" autocomplete="off" style="width:100%;box-sizing:border-box;padding:6px;background:#111;color:#eee;border:1px solid #555;">
      <div style="text-align:right;margin-top:10px;">
        <button id="saveApi" style="background:#2e8b57;color:white;padding:5px 10px;border:none;border-radius:4px;cursor:pointer;">Save</button>
      </div>
    `;
    document.body.appendChild(editor);
    editor.querySelector('#apiInput').value = SETTINGS.apiKey;
    Object.assign(editor.style, {margin:'auto', inset:'12px', width:'min(480px, calc(100vw - 48px))', maxHeight:'calc(100dvh - 48px)', overflow:'auto'});
    editor.addEventListener('close', () => editor.remove());
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.onclick = () => editor.close(); editor.append(cancel);
    editor.showModal();
    editor.querySelector("#saveApi").addEventListener("click", () => {
      SETTINGS.apiKey = editor.querySelector("#apiInput").value.trim();
      saveSettings(SETTINGS);
      editor.close();
      openTracker();
      fetchData();
    });
  }

  function showSettingsEditor() {
    if (document.getElementById('simple-tax-settings')) return;
    const editor = document.createElement('dialog'); editor.id = 'simple-tax-settings';
    editor.style.cssText = `position:fixed;inset:10% max(12px,20%);overflow:auto;background:#222;color:white;padding:20px;border:1px solid #777;border-radius:8px;z-index:${LAYER_Z_INDEX.modal};font:14px system-ui`;
    editor.style.margin = 'auto';
    editor.style.maxHeight = 'calc(100dvh - 48px)';
    editor.style.boxSizing = 'border-box';
    editor.setAttribute('aria-labelledby', 'simple-settings-title');
    editor.innerHTML = `<style>
      #simple-tax-settings {inset:16px !important;width:560px !important;max-width:calc(100vw - 32px) !important;height:fit-content !important;max-height:calc(100dvh - 32px) !important;margin:auto !important;padding:24px !important;border:1px solid #46515d !important;border-radius:14px !important;background:#1c2128 !important;color:#eef2f6 !important;font:14px/1.5 system-ui,sans-serif !important;box-shadow:0 20px 80px #0009 !important;overscroll-behavior:contain;}
      #simple-tax-settings::backdrop {background:#0008;}
      #simple-tax-settings * {box-sizing:border-box;}
      #simple-tax-settings h2 {margin:0 0 4px !important;padding:0 !important;font:700 22px/1.3 system-ui !important;color:#fff !important;}
      #simple-tax-settings h3 {margin:0 0 14px !important;font:600 14px/1.4 system-ui !important;color:#eef2f6 !important;}
      #simple-tax-settings p {margin:6px 0 0 !important;color:#b9c4cf !important;font:13px/1.5 system-ui !important;}
      #simple-tax-settings .tax-setting-section {margin-top:20px;padding:16px;background:#252c35;border:1px solid #39434e;border-radius:10px;}
      #simple-tax-settings .tax-setting-grid {display:grid;grid-template-columns:1fr 1fr;gap:14px;}
      #simple-tax-settings label {display:block !important;margin:0 !important;color:#e2e9f0 !important;font:500 13px/1.5 system-ui !important;}
      #simple-tax-settings input {display:block !important;width:100% !important;min-width:0 !important;height:42px !important;margin:6px 0 0 !important;padding:9px 11px !important;border:1px solid #596778 !important;border-radius:7px !important;background:#141a21 !important;color:#fff !important;font:400 15px/1.4 system-ui !important;color-scheme:dark;box-shadow:none !important;}
      #simple-tax-settings input:focus-visible, #simple-tax-settings button:focus-visible, #simple-tax-settings summary:focus-visible {outline:2px solid #80bfff !important;outline-offset:3px !important;}
      #simple-tax-settings input[type="checkbox"] {display:inline-block !important;width:16px !important;height:16px !important;margin:0 7px 0 0 !important;padding:0 !important;vertical-align:middle;}
      #simple-tax-settings .tax-setting-help {display:block;margin-top:7px;color:#aebdcb;font:12px/1.5 system-ui;}
      #simple-tax-settings .tax-key-note {padding:10px 12px;margin-bottom:14px;border-left:3px solid #77b9ed;background:#1c2937;border-radius:5px;color:#cddff0;font:13px/1.5 system-ui;}
      #simple-tax-settings details {margin-top:18px;border:1px solid #39434e;border-radius:8px;padding:12px 14px;}
      #simple-tax-settings summary {cursor:pointer;color:#d9e3ed;font-weight:600;}
      #simple-tax-settings details[open] summary {margin-bottom:14px;}
      #simple-tax-settings button {width:auto !important;height:auto !important;margin:0 !important;padding:10px 15px !important;border:1px solid #596778 !important;border-radius:7px !important;background:#303a46 !important;color:#f4f7fa !important;font:600 13px/1.4 system-ui !important;cursor:pointer !important;text-shadow:none !important;box-shadow:none !important;}
      #simple-tax-settings button:hover {filter:brightness(1.15);}
      #simple-tax-settings #simple-save {background:#28784f !important;border-color:#419d70 !important;}
      #simple-tax-settings .tax-setting-footer {position:sticky;bottom:-24px;display:flex;justify-content:flex-end;gap:10px;margin:20px -24px -24px;padding:16px 24px;background:#1c2128;border-top:1px solid #39434e;}
      #simple-tax-settings #simple-settings-error {color:#ffb5b5 !important;}
      #simple-tax-settings #simple-settings-error:empty {display:none;}
      @media(max-width:480px) {#simple-tax-settings .tax-setting-grid {grid-template-columns:1fr;} #simple-tax-settings {padding:18px !important;} #simple-tax-settings .tax-setting-footer {margin:18px -18px -18px;padding:14px 18px;bottom:-18px;}}
    </style>
      <h2 id="simple-settings-title">Payment settings</h2>
      <p>Sunday–Saturday · UTC</p>
      <section class="tax-setting-section"><h3>Torn API connection</h3>
        <div class="tax-key-note"><strong>Full Access required for cash logs.</strong><br>A custom key with the required log permissions also works. Limited Access cannot read these logs.</div>
        <label for="simple-key">API key</label><input id="simple-key" type="password" autocomplete="off" spellcheck="false" aria-describedby="simple-key-help">
        <span class="tax-setting-help" id="simple-key-help">Stored in this browser. Sent only to Torn’s API.</span>
        ${apiUsageDisclosure()}
      </section>
      <section class="tax-setting-section"><h3>Weekly payment</h3>
        <div class="tax-setting-grid">
          <label>Cash amount ($)<input id="simple-cash" type="number" min="1" required></label>
          <label>Item quantity<input id="simple-items" type="number" min="1" required></label>
        </div>
        <label style="margin-top:14px !important">Item name<input id="simple-item" required></label>
        <p id="simple-rate-preview" aria-live="polite"></p>
        <span class="tax-setting-help">Staff can pay in cash, items, or a mix of both.</span>
      </section>
      <section class="tax-setting-section"><h3>Calculate from Tax Period</h3>
        <div class="tax-setting-grid">
          <label>Start date<input id="simple-start" type="date"></label>
          <label>Weeks to display<input id="simple-weeks" type="number" min="1" max="52" required></label>
        </div>
        <label style="margin-top:12px !important"><input id="simple-latest" type="checkbox">Always show the latest period</label>
        <p>Weeks run Sunday–Saturday (UTC). A chosen date uses that week's Sunday. Bulk payments check the previous period first, extending further back if the payment covers more weeks. Only the selected period's balance is displayed.</p>
        <span class="tax-setting-help">Payment records are cached in this browser. Refresh checks for new receipts.</span>
      </section>
      <details><summary>Advanced and backup</summary>
        <label style="margin-top:14px !important">Payment search limit (API pages)<input id="simple-pages" type="number" min="1" max="100" aria-describedby="simple-pages-help"></label>
        <span class="tax-setting-help" id="simple-pages-help">Maximum batches of payment records fetched for each receipt type. Each page contains up to 100 logs. This limits loading time, not the number of weeks calculated. Increase it only if the tracker reports incomplete payment history.</span>
        <p>Changing rates recalculates the tracked period. Per-member overrides and carrybacks are preserved but not applied in this view.</p>
        <div style="margin-top:14px"><button type="button" id="simple-backup">Download settings backup</button></div>
        <span class="tax-setting-help">Your API key is excluded from the backup.</span>
      </details>
      <p id="simple-settings-error" role="alert"></p>
      <footer class="tax-setting-footer"><button type="button" id="simple-cancel">Cancel</button><button type="button" id="simple-save">Save and refresh</button></footer>`;
    const period = getTrackingPeriod();
    const fields = {key: SETTINGS.apiKey, cash: SETTINGS.defaultMoneyTax, items: SETTINGS.defaultItemTax, item: SETTINGS.taxItemName, start: period.startDate, weeks: period.requestedWeeks, pages: SETTINGS.maxLogPages};
    for (const [id, value] of Object.entries(fields)) editor.querySelector('#simple-' + id).value = value;
    editor.querySelector('#simple-latest').checked = !SETTINGS.periodStart;
    editor.querySelector('#simple-start').addEventListener('input', () => { editor.querySelector('#simple-latest').checked = false; });
    editor.querySelector('#simple-latest').addEventListener('change', event => {
      if (event.target.checked) editor.querySelector('#simple-start').value = getTrackingPeriod(new Date(), {periodWeeks:Number(editor.querySelector('#simple-weeks').value)}).startDate;
    });
    const updateRatePreview = () => {
      const cash = Number(editor.querySelector('#simple-cash').value);
      const quantity = Number(editor.querySelector('#simple-items').value);
      const item = editor.querySelector('#simple-item').value.trim();
      editor.querySelector('#simple-rate-preview').textContent = cash > 0 && quantity > 0 && item ? `One week = $${cash.toLocaleString()} or ${quantity.toLocaleString()} ${item}` : '';
    };
    for (const id of ['cash', 'items', 'item']) editor.querySelector('#simple-' + id).addEventListener('input', updateRatePreview);
    updateRatePreview();
    editor.querySelector('#simple-cancel').onclick = () => editor.close();
    editor.addEventListener('close', () => editor.remove());
    editor.querySelector('#simple-backup').onclick = () => {
      const copy = JSON.parse(JSON.stringify(SETTINGS)); delete copy.apiKey;
      const url = URL.createObjectURL(new Blob([JSON.stringify({profile: ACTIVE_PROFILE_ID, settings: copy}, null, 2)], {type:'application/json'}));
      const a = document.createElement('a'); a.href = url; a.download = 'torn-tax-settings-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    editor.querySelector('#simple-save').onclick = () => {
      const error = editor.querySelector('#simple-settings-error');
      if (fetching) { error.textContent = 'Wait for the current refresh to finish before changing settings.'; return; }
      for (const input of editor.querySelectorAll('input')) if (!input.checkValidity()) { input.reportValidity(); return; }
      const value = id => editor.querySelector('#simple-' + id).value.trim();
      if (!value('key') || !value('item')) { error.textContent = 'Enter an API key and item name.'; return; }
      const periodSettings = {periodStart: editor.querySelector('#simple-latest').checked ? '' : value('start'), periodWeeks:Number(value('weeks'))};
      try { getTrackingPeriod(new Date(), periodSettings); } catch (err) { error.textContent = err.message; return; }
      SETTINGS.apiKey = value('key'); SETTINGS.defaultMoneyTax = Number(value('cash')); SETTINGS.defaultItemTax = Number(value('items')); SETTINGS.taxItemName = value('item');
      SETTINGS.periodStart = periodSettings.periodStart; SETTINGS.periodWeeks = periodSettings.periodWeeks; SETTINGS.maxLogPages = Number(value('pages'));
      SETTINGS.testMode = false;
      saveSettings(SETTINGS); editor.close(); fetchData(true);
    };
    document.body.append(editor);
    editor.showModal();
  }

  function showEmployeeEditor() {
    const editor = document.createElement("div");
    Object.assign(editor.style, {
      position: "fixed", top: "20%", left: "30%", width: "40%",
      background: "#222", color: "#fff", padding: "15px", zIndex: String(LAYER_Z_INDEX.modal),
      borderRadius: "8px", boxShadow: "0px 0px 10px rgba(0,0,0,0.7)"
    });

    let text = "";
    Object.keys(SETTINGS.manualMembers).forEach(id => {
      const req = getMemberRequirement(id);
      const name = getEmployeeName(SETTINGS.manualMembers[id]);
      text += `${id}:${name}:${req.type}:${req.amount}\n`;
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
    bringToFront(editor);

    editor.querySelector("#cancelEmp").addEventListener("click", () => editor.remove());
    editor.querySelector("#saveEmp").addEventListener("click", () => {
      const lines = editor.querySelector("#empInput").value.split("\n");
      const newList = {};
      const newReqs = {};
      const previousRequirements = {};
      Object.keys(SETTINGS.manualMembers || {}).forEach(id => {
        previousRequirements[id] = getMemberRequirement(id);
      });
      lines.forEach(line => {
        if (!line.trim()) return;
        const parts = line.split(":").map(x => x.trim());
        const [id, name, type, amount] = parts;
        if (id && name) {
          const existing = normalizeEmployeeRecord(SETTINGS.manualMembers[id]);
          newList[id] = normalizeEmployeeRecord({
            name,
            joinDays: existing.joinDays,
            joinDate: existing.joinDate
          });
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
      if (SETTINGS.memberRequirementResets) {
        Object.keys(SETTINGS.memberRequirementResets).forEach(id => {
          if (!newList[id]) {
            delete SETTINGS.memberRequirementResets[id];
          }
        });
      }
      if (SETTINGS.memberWeekExclusions) {
        Object.keys(SETTINGS.memberWeekExclusions).forEach(id => {
          if (!newList[id]) {
            delete SETTINGS.memberWeekExclusions[id];
          }
        });
      }
      if (SETTINGS.memberWeekCarrybacks) {
        Object.keys(SETTINGS.memberWeekCarrybacks).forEach(id => {
          if (!newList[id]) {
            delete SETTINGS.memberWeekCarrybacks[id];
          }
        });
      }
      SETTINGS.memberRequirements = Object.assign({}, SETTINGS.memberRequirements, newReqs);
      Object.keys(newList).forEach(id => {
        const prev = previousRequirements[id];
        const current = getMemberRequirement(id);
        if (!prev || prev.type !== current.type || prev.amount !== current.amount || (!!prev.isDefault) !== (!!current.isDefault)) {
          SETTINGS.memberRequirementResets[id] = getCurrentWeekKey();
        }
      });
      saveSettings(SETTINGS);
      editor.remove();
      fetchData();
    });
  }

  async function fetchData(forceRefresh = false) {
    if (fetching) return;
    fetching = true;
    scanComplete = false;
    setStatus("Fetching payment history…", "info");
    let employees = {};
    let weeklyData = {};
    let paymentHistory = {};
    let logScanHitPageLimit = false;
    try {
      if (SETTINGS.testMode) {
        const fake = makeFakeData();
        employees = fake.employees;
        weeklyData = fake.weeklyData;
        paymentHistory = fake.paymentHistory || buildPaymentHistoryFromAggregates(fake.weeklyData);
      } else {
        if (SETTINGS.manualMode) {
          employees = normalizeEmployeeMap(SETTINGS.manualMembers);
          SETTINGS.manualMembers = employees;
        } else {
          const data = await tornFetch('company/', {selections:'employees'});
          if (data && data.error) {
            throw new Error(`Torn API error (${data.error.code}): ${data.error.error}`);
          }
          employees = {};
          Object.keys(data.company_employees || {}).forEach(id => {
            const info = data.company_employees[id];
            if (!info) {
              return;
            }
            const joinDaysValue = info.days_in_company == null ? NaN : Number(info.days_in_company);
            const joinDateValue = Number(info.join_date);
            employees[id] = {
              name: typeof info.name === "string" ? info.name : "",
              joinDays: Number.isFinite(joinDaysValue) ? joinDaysValue : null,
              joinDate: Number.isFinite(joinDateValue) && joinDateValue > 0 ? joinDateValue : null
            };
          });
        }

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

        const itemCatalog = await ensureItemCatalog();
        const configuredItemName = (SETTINGS.taxItemName || DEFAULT_SETTINGS.taxItemName).trim();
        const configuredItemId = getItemIdForName(configuredItemName) || (normalizeItemName(configuredItemName) === 'xanax' ? DEFAULT_TAX_ITEM_ID : undefined);
        const configuredItemDisplayName = configuredItemId === 206
          ? configuredItemName
          : ((itemCatalog.byId && itemCatalog.byId[configuredItemId] && itemCatalog.byId[configuredItemId].name) || configuredItemName);

        const employeeNameIndex = buildEmployeeNameIndex(employees);
        const logStartUnix = determineLogStartUnix();
        const logTypes = await getReceiptLogTypes();
        const period = getTrackingPeriod();
        let logResult = await fetchReceiptLogs(logTypes, logStartUnix, SETTINGS.maxLogPages);
        let neededWeeks = period.requestedWeeks;
        for (const log of Object.values(logResult.logs)) {
          const timestamp = Number(log.timestamp);
          if (timestamp < period.startUnix || timestamp > period.endUnix || !isLikelyIncomingMoneyLog(log)) continue;
          if (!findEmployeeIdFromLog(log, employees, employeeNameIndex)) continue;
          const quantity = getItemQuantityFromLog(log, configuredItemDisplayName, configuredItemId);
          const equivalents = quantity > 0 ? quantity / SETTINGS.defaultItemTax : getMoneyAmountFromLog(log) / SETTINGS.defaultMoneyTax;
          neededWeeks = Math.max(neededWeeks, Math.ceil(equivalents));
        }
        if (neededWeeks > 520) throw new Error('A payment implies over 520 weeks at the configured rate. Check the payment rates before calculating.');
        if (neededWeeks > period.requestedWeeks) {
          logResult = await fetchReceiptLogs(logTypes, period.startUnix - neededWeeks * MILLIS_PER_WEEK / 1000, SETTINGS.maxLogPages);
        }
        const logs = logResult.logs;

        generateRecentWeekKeys(SETTINGS.maxWeeks).forEach(key => {
          weeklyData[key] = {};
        });

        for (const id in logs) {
          const log = logs[id];
          const ts = unixLogDate(log);
          if (!ts) continue;
          const weekKey = getIsoWeekKey(ts);
          if (ts.getTime() > period.endUnix * 1000) continue;
          const logId = String(id);
          const senderId = findEmployeeIdFromLog(log, employees, employeeNameIndex);
          if (!senderId) continue;

          if (!weeklyData[weekKey]) {
            weeklyData[weekKey] = {};
          }
          if (!weeklyData[weekKey][senderId]) {
            weeklyData[weekKey][senderId] = { money: 0, items: 0 };
          }
          if (!paymentHistory[senderId]) {
            paymentHistory[senderId] = [];
          }

          const itemQuantity = getItemQuantityFromLog(log, configuredItemDisplayName, configuredItemId);
          if (itemQuantity > 0 && isLikelyIncomingMoneyLog(log)) {
            const paymentId = `item:${logId}`;
            const excluded = isPaymentExcluded(senderId, paymentId);
            if (!excluded) {
              weeklyData[weekKey][senderId].items += itemQuantity;
            }
            paymentHistory[senderId].push({
              id: paymentId,
              logId,
              timestamp: Number(log.timestamp) * 1000,
              weekKey,
              type: 'item',
              amount: itemQuantity,
              medium: describeLogMedium(log),
              excluded
            });
            continue;
          }

          const moneyAmount = getMoneyAmountFromLog(log);
          if (moneyAmount > 0 && isLikelyIncomingMoneyLog(log)) {
            const paymentId = `money:${logId}`;
            const excluded = isPaymentExcluded(senderId, paymentId);
            if (!excluded) {
              weeklyData[weekKey][senderId].money += moneyAmount;
            }
            paymentHistory[senderId].push({
              id: paymentId,
              logId,
              timestamp: Number(log.timestamp) * 1000,
              weekKey,
              type: 'money',
              amount: moneyAmount,
              medium: describeLogMedium(log),
              excluded
            });
          }
        }

        if (logResult.hitPageLimit) {
          logScanHitPageLimit = true;
        }
      }

      if (SETTINGS.testMode) syncExcludedPaymentsWithWeeklyData(paymentHistory, weeklyData);
      scanComplete = !logScanHitPageLimit;

      lastEmployeesCache = employees;
      lastWeeklyDataCache = weeklyData;
      Object.keys(employees).forEach(id => {
        if (!paymentHistory[id]) {
          paymentHistory[id] = [];
        }
      });
      Object.keys(paymentHistory).forEach(id => {
        paymentHistory[id].sort((a, b) => {
          const timeA = Number(a && a.timestamp);
          const timeB = Number(b && b.timestamp);
          return timeA - timeB;
        });
      });
      lastPaymentHistoryCache = paymentHistory;
      saveSettings(SETTINGS);

      renderOverview(weeklyData, employees);
      if (SETTINGS.enableEmployeeMenu) {
        renderEmployeeMenu(employees);
      }
      if (!SETTINGS.enableEmployeeMenu && currentView === "employees") {
        switchView("overview");
      }
      if (currentView === "payments") {
        renderPaymentHistory(paymentHistory, employees);
      }
      const employeeCount = Object.keys(employees).length;
      const mode = SETTINGS.testMode ? "test mode" : (SETTINGS.manualMode ? "manual mode" : "live API");
      if (logScanHitPageLimit) {
        setStatus(`Payment history is incomplete. Increase the history scan limit in Settings and refresh. Unpaid balances cannot be confirmed.`, "error");
      } else {
        setStatus(`Loaded ${employeeCount} employee${employeeCount === 1 ? "" : "s"} (${mode}, profile: ${ACTIVE_PROFILE_ID})${forceRefresh ? " • refreshed" : ""}.`, "success");
      }
    } catch (err) {
      scanComplete = false;
      renderOverview(lastWeeklyDataCache, lastEmployeesCache);
      console.error("Failed to fetch tax data", err);
      setStatus(`Failed to load data: ${err && err.message ? err.message : "Unknown error"}`, "error");
    } finally { fetching = false; }
  }

  async function tornFetch(endpoint, params) {
    if (!SETTINGS.apiKey) {
      throw new Error("No Torn API key saved. Open Settings and add an API key.");
    }
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        query.set(key, value);
      }
    });
    const requestKey = SETTINGS.apiKey;
    query.set("key", requestKey);

    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        await waitForApiSlot();
        if (!SETTINGS.apiKey || SETTINGS.apiKey !== requestKey) throw new Error('API key changed or was disabled. Open Settings before refreshing.');
        const res = await fetch(`https://api.torn.com/${endpoint}?${query.toString()}`);
        if (res.status === 429) {
          const retryAfter = Number(res.headers?.get('Retry-After'));
          setApiCooldown(Math.max(60000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 60000));
          const error = new Error('Torn API rate limit reached. Requests are paused for at least 60 seconds; refresh later. Other tools share your account limit.');
          error.apiCooldown = true; throw error;
        }
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (jsonError) {
          throw new Error(`Torn returned invalid JSON (HTTP ${res.status}). Response begins: ${text.slice(0, 180)}`);
        }
        if (data && data.error) {
          const code = Number(data.error.code);
          const message = code === 16 ? 'Full Access API key required for cash/item payment logs (or a custom key with the required log permissions). Update the key in Settings.' : String(data.error.error || "Unknown Torn API error");
          if ([1, 2, 10, 13, 18].includes(code)) {
            retireApiKey(requestKey);
            const error = new Error(`Torn API error (${code}): ${message}. The saved key has been removed from use. Add a valid, enabled key in Settings.`);
            error.apiAuthFailure = true; throw error;
          }
          if ([5, 8].includes(code)) {
            setApiCooldown(60000);
            const error = new Error(`Torn API error (${code}): ${message}. Requests are paused for at least 60 seconds; refresh later.`);
            error.apiCooldown = true; throw error;
          }
          if ([9, 12, 15, 17, 24].includes(code) && attempt < 4) {
            await delay(retryDelayMs(attempt));
            continue;
          }
          throw new Error(`Torn API error (${code}): ${message}`);
        }
        if (!res.ok) {
          throw new Error(`Torn API HTTP error ${res.status}. Response begins: ${text.slice(0, 180)}`);
        }
        return data || {};
      } catch (error) {
        lastError = error;
        if (!error.apiAuthFailure && !error.apiCooldown && attempt < 4 && isRetryableNetworkError(error)) {
          await delay(retryDelayMs(attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error("Torn API request failed.");
  }

  function apiUsageDisclosure() {
    return `<div class="tax-api-disclosure" style="margin:12px 0;padding:12px;border:1px solid #46515d;border-radius:7px;font:12px/1.5 system-ui;color:#dbe5ef;background:#18212b">
      <strong>API usage &amp; privacy</strong>
      <dl style="margin:8px 0">
        <dt style="font-weight:600">Purpose</dt><dd style="margin:0 0 7px">Read company staff and incoming cash/item logs to calculate payments, arrears and reminder drafts.</dd>
        <dt style="font-weight:600">Storage</dt><dd style="margin:0 0 7px">Key, settings, cached receipts, write-offs and reminder drafts are stored in this browser until cleared. Drafts stop being used after 30 minutes. Uninstalling the userscript does not erase browser storage.</dd>
        <dt style="font-weight:600">Sharing</dt><dd style="margin:0 0 7px">No uploads to the developer, analytics or third-party services. API requests go directly to api.torn.com. At your request, a reminder is placed in Torn’s message composer; you review and send it yourself.</dd>
        <dt style="font-weight:600">Key storage</dt><dd style="margin:0 0 7px">The key is stored locally, not encrypted, and sent to Torn over HTTPS. It is excluded from settings backups. Cached data is not isolated from other scripts running on the same Torn origin.</dd>
        <dt style="font-weight:600">Required access</dt><dd style="margin:0">Full Access, or a custom key permitting company/employees, user/log for the relevant incoming cash/item types, and torn/items and torn/logtypes.</dd>
      </dl>
      <span>Requests are paced to about 54/minute across this script’s cooperating tabs. Other tools and browsers still share Torn’s account limit.</span>
      <a href="https://www.torn.com/api.html" target="_blank" rel="noopener noreferrer" style="color:#91caff">Torn API guidelines</a>
    </div>`;
  }

  function retireApiKey(key) {
    if (SETTINGS.apiKey === key) SETTINGS.apiKey = '';
    for (const profile of PROFILE_META.knownProfileIds) {
      try {
        const storageKey = getSettingsStorageKey(profile);
        const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
        if (saved.apiKey === key) { saved.apiKey = ''; localStorage.setItem(storageKey, JSON.stringify(saved)); }
      } catch { /* The in-memory key remains disabled if browser storage fails. */ }
    }
    try { saveSettings(SETTINGS); } catch { console.warn('Invalid API key disabled in this tab; browser storage could not be updated.'); }
  }

  function readApiSchedule() {
    try { return JSON.parse(localStorage.getItem('torn_tax_api_schedule_v1') || '{}') || {}; } catch { return {}; }
  }

  function setApiCooldown(milliseconds) {
    apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + milliseconds);
    const saved = readApiSchedule();
    try { localStorage.setItem('torn_tax_api_schedule_v1', JSON.stringify({...saved, cooldownUntil:Math.max(Number(saved.cooldownUntil) || 0, apiCooldownUntil)})); } catch { /* Keep the local cooldown. */ }
  }

  function waitForApiSlot() {
    const reserve = async () => {
      const now = Date.now(), saved = readApiSchedule();
      const cooldown = Math.max(apiCooldownUntil, Number(saved.cooldownUntil) || 0);
      if (cooldown > now) { const error = new Error(`API requests are paused. Try again in ${Math.ceil((cooldown - now) / 1000)} seconds.`); error.apiCooldown = true; throw error; }
      const slot = Math.max(now, nextApiRequestAt, Math.min(Number(saved.nextAt) || 0, now + 60000));
      nextApiRequestAt = slot + 1100;
      try { localStorage.setItem('torn_tax_api_schedule_v1', JSON.stringify({nextAt:nextApiRequestAt,cooldownUntil:cooldown})); } catch { /* Fall back to pacing this tab. */ }
      if (slot > now) await delay(slot - now);
      const latestCooldown = Math.max(apiCooldownUntil, Number(readApiSchedule().cooldownUntil) || 0);
      if (latestCooldown > Date.now()) {const error = new Error('API requests paused after a rate-limit response. Refresh later.');error.apiCooldown=true;throw error;}
    };
    const task = apiRequestQueue.then(() => navigator.locks?.request ? navigator.locks.request('torn-tax-api-request', reserve) : reserve());
    apiRequestQueue = task.catch(() => {});
    return task;
  }

  async function fetchAllLogs(logTypes, fromUnix, maxPages) {
    const combined = {};
    let toUnix = Math.floor(Date.now() / 1000);
    let previousOldest = null;
    let hitPageLimit = false;
    const pageLimit = Math.min(100, Math.max(1, Number(maxPages) || DEFAULT_SETTINGS.maxLogPages));

    for (let page = 0; page < pageLimit; page += 1) {
      const params = {
        selections: "log",
        limit: 100,
        from: fromUnix,
        to: toUnix
      };
      if (String(logTypes || "").trim()) {
        params.log = String(logTypes).trim();
      }

      const response = await tornFetch("user/", params);
      if (!response.log || typeof response.log !== 'object') {
        throw new Error('Torn returned no log collection. Check API log access.');
      }
      const logs = response.log;
      const ids = Object.keys(logs);
      if (!ids.length) {
        break;
      }

      let oldest = null;
      ids.forEach(id => {
        combined[id] = logs[id];
        const timestamp = Number((logs[id] || {}).timestamp || 0);
        if (timestamp > 0 && (oldest === null || timestamp < oldest)) {
          oldest = timestamp;
        }
      });

      // A short page exhausts this filtered stream. Do not request the final
      // timestamp again and mistake its repeated receipt for stalled history.
      if (ids.length < 100) break;

      if (oldest === null || oldest === previousOldest) {
        hitPageLimit = true;
        break;
      }
      if (oldest <= fromUnix) {
        break;
      }
      previousOldest = oldest;
      // Overlap the boundary second and deduplicate by log ID to avoid losing
      // payments that share a timestamp. A stalled boundary stays unconfirmed.
      toUnix = oldest;

      if (page === pageLimit - 1 && oldest > fromUnix) {
        hitPageLimit = true;
      }
    }

    return { logs: combined, hitPageLimit };
  }

  function receiptLogTypesFromCatalog(catalog) {
    const types = [];
    for (const [key, value] of Object.entries(catalog || {})) {
      const id = Number(value && typeof value === 'object' ? (value.id ?? key) : key);
      const title = String(value && typeof value === 'object' ? (value.title || value.name || '') : value);
      if (Number.isInteger(id) && /\b(money|cash|item|items|company)\b/i.test(title) &&
          /\b(receive|received|deposit|deposited)\b/i.test(title) &&
          !/\b(send|sent|withdraw|withdrawn|buy|sell)\b/i.test(title)) types.push(String(id));
    }
    return [...new Set(types)];
  }

  async function getReceiptLogTypes() {
    const response = await tornFetch('torn/', {selections:'logtypes'});
    const types = receiptLogTypesFromCatalog(response.logtypes);
    if (!types.length) throw new Error('Could not identify incoming cash/item log types. Check API access to torn/logtypes.');
    return types;
  }

  async function fetchReceiptLogs(types, fromUnix, maxPages) {
    const logs = {};
    let hitPageLimit = false;
    const cacheKey = await paymentCacheKey();
    let cache;
    try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}'); } catch { cache = {}; }
    if (!cache || cache.version !== 1 || !cache.streams || typeof cache.streams !== 'object') cache = {version:1, streams:{}};
    for (let index = 0; index < types.length; index++) {
      setStatus(`Checking payment history (${index + 1}/${types.length} receipt types)…`, 'info');
      const type = types[index];
      const previous = cache.streams[type];
      const reusable = previous && previous.complete && Number.isFinite(previous.from) && previous.from <= fromUnix && Number.isFinite(previous.through) && previous.logs && typeof previous.logs === 'object';
      const through = Math.floor(Date.now() / 1000);
      const scanFrom = reusable ? Math.max(fromUnix, previous.through - 300) : fromUnix;
      const result = await fetchAllLogs(type, scanFrom, maxPages);
      const combined = Object.assign({}, previous && previous.logs, result.logs);
      for (const [id, log] of Object.entries(combined)) {
        if (Number(log.timestamp) >= fromUnix && Number(log.timestamp) <= through) logs[id] = log;
      }
      hitPageLimit = hitPageLimit || result.hitPageLimit;
      // A partial request never advances the complete-coverage checkpoint.
      cache.streams[type] = result.hitPageLimit && reusable
        ? {...previous, logs:combined}
        : {from: reusable ? previous.from : fromUnix, through, complete:!result.hitPageLimit, logs:combined};
      try { localStorage.setItem(cacheKey, JSON.stringify(cache)); }
      catch (error) { console.warn('Payment cache could not be saved; using live results.', error); }
    }
    return {logs, hitPageLimit};
  }

  async function paymentCacheKey() {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SETTINGS.apiKey));
    const fingerprint = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2,'0')).join('');
    return `torn_tax_receipts_v1_${ACTIVE_PROFILE_ID}_${fingerprint}`;
  }

  function determineLogStartUnix() {
    const period = getTrackingPeriod();
    return period.startUnix - period.requestedWeeks * MILLIS_PER_WEEK / 1000;
  }

  function getTrackingPeriod(now = new Date(), settings = SETTINGS) {
    const requestedWeeks = Math.min(52, Math.max(1, Number(settings.periodWeeks) || 6));
    const currentWeek = getIsoWeekKey(now);
    const currentSunday = isoWeekStartDate(currentWeek).getTime();
    const chosen = settings.periodStart ? new Date(settings.periodStart + 'T00:00:00Z') : null;
    if (chosen && !Number.isFinite(chosen.getTime())) throw new Error('Choose a valid start date.');
    const start = chosen ? isoWeekStartDate(getIsoWeekKey(chosen)).getTime() : currentSunday - (requestedWeeks - 1) * MILLIS_PER_WEEK;
    if (start > currentSunday) throw new Error('The start date cannot be in a future week.');
    const end = Math.min(start + requestedWeeks * MILLIS_PER_WEEK - 1, now.getTime());
    const weeks = [];
    for (let timestamp = start; timestamp <= end; timestamp += MILLIS_PER_WEEK) weeks.push(getIsoWeekKey(new Date(timestamp)));
    return {requestedWeeks, weeks, startUnix:start/1000, endUnix:Math.floor(end/1000), currentWeek, startDate:new Date(start).toISOString().slice(0,10)};
  }

  function getYtdPeriod(now = new Date()) {
    const year = now.getUTCFullYear();
    const januaryFirst = new Date(Date.UTC(year, 0, 1));
    const currentWeek = getIsoWeekKey(now);
    const weeks = [];
    const firstSunday = isoWeekStartDate(getIsoWeekKey(januaryFirst)).getTime();
    const currentSunday = isoWeekStartDate(currentWeek).getTime();
    for (let timestamp = firstSunday; timestamp <= currentSunday; timestamp += MILLIS_PER_WEEK) weeks.push(getIsoWeekKey(new Date(timestamp)));
    return {year, fromUnix: januaryFirst.getTime() / 1000, weeks, currentWeek};
  }


  function generateRecentWeekKeys(count) {
    const keys = [];
    const currentStart = isoWeekStartDate(getIsoWeekKey(new Date()));
    const safeCount = Math.min(52, Math.max(1, Number(count) || ROLLING_WINDOW_WEEKS));
    for (let i = safeCount - 1; i >= 0; i -= 1) {
      keys.push(getIsoWeekKey(new Date(currentStart.getTime() - i * MILLIS_PER_WEEK)));
    }
    return keys;
  }

  function rollingWindowStartWeekFor(trackFromWeek, weekKey, windowWeeks) {
    const weekStart = isoWeekStartDate(weekKey);
    const windowStart = getIsoWeekKey(new Date(
      weekStart.getTime() - Math.max(Number(windowWeeks) - 1, 0) * MILLIS_PER_WEEK
    ));
    return compareWeekKeys(trackFromWeek, windowStart) >= 0 ? trackFromWeek : windowStart;
  }

  function getIsoWeekKey(date) {
    const source = new Date(date);
    const d = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate() + 1));
    const dayNumber = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
    const year = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((d - yearStart) / MILLIS_PER_DAY) + 1) / 7);
    return formatWeekKey(year, week);
  }

  function isoWeekStartDate(weekKey) {
    const parsed = parseWeekKey(weekKey);
    if (!parsed) {
      throw new Error(`Invalid tax week key: ${weekKey}`);
    }
    const [year, week] = parsed;
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const day = januaryFourth.getUTCDay() || 7;
    const weekOneMonday = new Date(januaryFourth.getTime());
    weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - day + 1);
    return new Date(weekOneMonday.getTime() + (week - 1) * MILLIS_PER_WEEK - MILLIS_PER_DAY);
  }

  function weeksInclusive(startWeekKey, endWeekKey) {
    const start = isoWeekStartDate(startWeekKey).getTime();
    const end = isoWeekStartDate(endWeekKey).getTime();
    if (end < start) {
      return 0;
    }
    return Math.floor((end - start) / MILLIS_PER_WEEK) + 1;
  }

  function unixLogDate(log) {
    const timestamp = Number(log && log.timestamp || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    const date = new Date(timestamp * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function retryDelayMs(attempt) {
    return Math.min(8000, 500 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 250);
  }

  function isRetryableNetworkError(error) {
    const message = String(error && error.message || error).toLowerCase();
    return message.includes("timed out") ||
      message.includes("failed to fetch") ||
      message.includes("network") ||
      message.includes("http error 429") ||
      message.includes("http error 5");
  }

  function parsePositiveAmount(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    const text = String(value || "").trim();
    if (!text) {
      return 0;
    }
    const cleaned = text.replace(/[$£,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) {
      return 0;
    }
    const number = Number(cleaned);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function isLikelyIncomingMoneyLog(log) {
    const data = log && log.data ? log.data : {};
    const searchable = [
      log && log.title, log && log.log, log && log.category,
      data.action, data.type
    ].filter(value => value !== undefined && value !== null)
      .join(" ")
      .toLowerCase();

    if (/\b(send|sent|give|gave|paid out|withdrew|withdrawn|removed|buy|bought|use|used|sell|sold)\b/.test(searchable)) {
      return false;
    }
    if (/\b(receive|received|incoming|given to you|deposit|deposited)\b/.test(searchable)) {
      return true;
    }
    return false;
  }

  function hasOwnPositiveMoneyField(data) {
    const keys = ["money", "amount", "cash", "money_received", "received", "value"];
    for (let i = 0; i < keys.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(data || {}, keys[i])) {
        continue;
      }
      const value = parsePositiveAmount(data[keys[i]]);
      if (Number.isFinite(value) && value > 0) {
        return true;
      }
    }
    return false;
  }

  function getWeekNumber(d) {
    const parsed = parseWeekKey(getIsoWeekKey(d));
    return parsed || [d.getUTCFullYear(), 1];
  }

  function getRelativeWeekFromCurrent(offsetWeeks) {
    const normalizedOffset = Number.isFinite(offsetWeeks) ? offsetWeeks : 0;
    const reference = new Date();
    reference.setUTCDate(reference.getUTCDate() + (normalizedOffset * 7));
    const [year, week] = getWeekNumber(reference);
    return { year, week };
  }

  function formatTimestamp(ms) {
    const numeric = Number(ms);
    if (!Number.isFinite(numeric)) {
      return '';
    }
    const date = new Date(numeric);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function getDateFromWeekKey(weekKey) {
    try {
      return isoWeekStartDate(weekKey);
    } catch (error) {
      return null;
    }
  }

  function formatWeekHeader(weekKey) {
    const parsed = parseWeekKey(weekKey);
    if (!parsed) {
      return { shortLabel: weekKey, fullLabel: weekKey, startLabel: 'Unknown' };
    }
    const [year, week] = parsed;
    const startDate = getDateFromWeekKey(weekKey);
    if (!startDate) {
      return {
        shortLabel: `W${week}`,
        fullLabel: `Week ${week}, ${year}`,
        startLabel: 'Unknown'
      };
    }
    const startLabel = startDate.toLocaleDateString(undefined, {
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC'
    });
    const fullStartLabel = startDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: '2-digit',
      timeZone: 'UTC'
    });
    return {
      shortLabel: `W${week}`,
      fullLabel: `Week ${week}, ${year}`,
      startLabel,
      fullStartLabel
    };
  }

  function getNextDueDateLabel() {
    const dueWeekday = Number(SETTINGS.paymentDueWeekday) || 0;
    const now = new Date();
    const today = now.getDay();
    let delta = dueWeekday - today;
    if (delta < 0) {
      delta += 7;
    }
    const dueDate = new Date(now);
    dueDate.setDate(now.getDate() + delta);
    const dueLabel = dueDate.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: '2-digit'
    });
    if (delta === 0) {
      return `${dueLabel} (today)`;
    }
    if (delta === 1) {
      return `${dueLabel} (tomorrow)`;
    }
    return `${dueLabel} (in ${delta} days)`;
  }

  function getEmployeeJoinWeek(record) {
    const ts = getEmployeeJoinTimestamp(record);
    if (!ts) {
      return null;
    }
    const joinDate = new Date(ts * 1000);
    if (Number.isNaN(joinDate.getTime())) {
      return null;
    }
    return getWeekNumber(joinDate);
  }

  function getEmployeeJoinWeekFromDays(record) {
    if (!record || record.joinDays == null) return null;
    const hireDate = new Date();
    hireDate.setUTCDate(hireDate.getUTCDate() - record.joinDays);
    return getWeekNumber(hireDate); // returns [year, week]
  }

  function makeDraggable(el, handle) {
    let offsetX = 0;
    let offsetY = 0;
    let isDown = false;
    let dragged = false;
    let suppressClick = false;

    handle.addEventListener('mousedown', e => {
      if (e.button !== 0 || e.target.closest('button,input,select,textarea,a,label')) return;
      isDown = true;
      dragged = false;
      offsetX = el.offsetLeft - e.clientX;
      offsetY = el.offsetTop - e.clientY;
      document.body.style.userSelect = "none";
      bringToFront(el);
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mouseup', e => {
      if (!isDown) {
        return;
      }
      isDown = false;
      document.body.style.userSelect = "";
      if (dragged) {
        suppressClick = true;
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    document.addEventListener('mousemove', e => {
      if (!isDown) {
        return;
      }
      dragged = true;
      el.style.left = Math.max(12, Math.min(window.innerWidth - el.offsetWidth - 12, e.clientX + offsetX)) + 'px';
      el.style.top = Math.max(12, Math.min(window.innerHeight - el.offsetHeight - 12, e.clientY + offsetY)) + 'px';
      e.preventDefault();
    });

    document.addEventListener('click', e => {
      if (!suppressClick) {
        return;
      }
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  function makeResizable(el) {
    const resizeHandle = document.createElement("div");
    Object.assign(resizeHandle.style, { width: "15px", height: "15px", background: "#444",
      position: "absolute", right: "0", bottom: "0", cursor: "se-resize", borderTopLeftRadius: "4px" });
    el.appendChild(resizeHandle);
    resizeHandle.addEventListener("mousedown", e => { e.preventDefault(); document.addEventListener("mousemove", resizePanel); document.addEventListener("mouseup", stopResize); });
    function resizePanel(e) {
      el.style.width = Math.max(280, Math.min(window.innerWidth - el.offsetLeft - 12, e.clientX - el.offsetLeft)) + 'px';
      el.style.height = Math.max(220, Math.min(window.innerHeight - el.offsetTop - 12, e.clientY - el.offsetTop)) + 'px';
    }
    function stopResize() { document.removeEventListener("mousemove", resizePanel); document.removeEventListener("mouseup", stopResize); }
  }

  function makeFakeData() {
    const now = Math.floor(Date.now() / 1000);
    const employees = normalizeEmployeeMap({
      101: { name: 'Alice', joinDays: 140, joinDate: now - (140 * 86400) },
      102: { name: 'Bob', joinDays: 90, joinDate: now - (90 * 86400) },
      103: { name: 'Charlie', joinDays: 30, joinDate: now - (30 * 86400) },
      104: { name: 'Diana', joinDays: 10, joinDate: now - (10 * 86400) }
    });
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
  // Pure calculation shared by the grid and balance. Payments cover oldest debt first.
  function calculatePaymentLedger(weeks, entries, cashRate, itemRate, complete) {
    const result = weeks.map(key => ({ key, coverage: 0 }));
    const valid = entries.filter(p => !p.excluded && Number.isFinite(p.amount) && p.amount > 0 && weeks.includes(p.weekKey));
    const available = valid.reduce((sum, p) => sum + p.amount / (p.type === 'money' ? cashRate : itemRate), 0);
    let remaining = available;
    for (const week of result) {
      week.coverage = Math.min(1, Math.max(0, remaining));
      week.status = week.coverage >= 1 - 1e-9 ? 'Paid' : !complete ? 'Unable to confirm' : week.coverage > 1e-9 ? 'Part paid' : 'Unpaid';
      remaining = Math.max(0, remaining - 1);
    }
    return { weeks: result, owedWeeks: Math.max(0, weeks.length - available), creditWeeks: Math.max(0, available - weeks.length) };
  }

  function calculatePeriodLedger(period, history, cashRate, itemRate, complete, joinKey, writeOffs = []) {
    const inPeriod = history.filter(p => !p.excluded && p.timestamp >= period.startUnix * 1000 && p.timestamp <= period.endUnix * 1000);
    const largest = inPeriod.reduce((max, p) => Math.max(max, Number(p.amount) / (p.type === 'money' ? cashRate : itemRate) || 0), 0);
    const lookbackWeeks = Math.max(period.requestedWeeks, Math.ceil(largest));
    const start = period.startUnix * 1000 - lookbackWeeks * MILLIS_PER_WEEK;
    const weeks = [];
    for (let timestamp = start; timestamp <= period.endUnix * 1000; timestamp += MILLIS_PER_WEEK) {
      const key = getIsoWeekKey(new Date(timestamp));
      if (!joinKey || compareWeekKeys(key, joinKey) >= 0) weeks.push(key);
    }
    const eligible = history.filter(p => !p.excluded && Number.isFinite(p.amount) && p.amount > 0 && p.timestamp >= start && p.timestamp <= period.endUnix * 1000 && weeks.includes(p.weekKey));
    const normal = {};
    let bulk = 0;
    for (const payment of eligible) {
      const equivalent = payment.amount / (payment.type === 'money' ? cashRate : itemRate);
      if (equivalent > 1 + 1e-9) bulk += equivalent;
      else normal[payment.weekKey] = (normal[payment.weekKey] || 0) + equivalent;
    }
    // Ordinary payments belong to their receipt week. Only larger payments,
    // or excess above a week's requirement, are allocated to older shortfalls.
    const calculated = weeks.map(key => {
      const received = normal[key] || 0;
      const writeOffCoverage = Math.min(1, writeOffs.filter(entry => entry.weekKey === key && Number.isFinite(entry.coverage) && entry.coverage > 0).reduce((sum, entry) => sum + entry.coverage, 0));
      bulk += Math.max(0, received - (1 - writeOffCoverage));
      return {key, coverage:writeOffCoverage + Math.min(1 - writeOffCoverage, received), writeOffCoverage};
    });
    for (const week of calculated) {
      const allocated = Math.min(1 - week.coverage, bulk);
      week.coverage += allocated;
      bulk = Math.max(0, bulk - allocated);
      week.status = week.coverage >= 1 - 1e-9 ? 'Paid' : !complete ? 'Unable to confirm' : week.coverage > 1e-9 ? 'Part paid' : 'Unpaid';
    }
    const visible = calculated.filter(week => period.weeks.includes(week.key));
    return {weeks:visible, owedWeeks:visible.reduce((sum, week) => sum + Math.max(0, 1 - week.coverage), 0), creditWeeks:bulk, lookbackWeeks};
  }

  function renderOverview(weeklyData, employees) {
    if (!overviewView) return;
    const period = getTrackingPeriod();
    const current = period.currentWeek;
    const visible = period.weeks;
    const cash = Number(SETTINGS.defaultMoneyTax) || 10000000;
    const items = Number(SETTINGS.defaultItemTax) || 7;
    overviewView.innerHTML = `<style>
      #tax-panel #simple-grid, #tax-panel #simple-grid th, #tax-panel #simple-grid td,
      #tax-panel #simple-details, #tax-panel #simple-details p, #tax-panel #simple-details h3 {color:#eee !important;background:#1b1b1b !important;}
      #tax-panel #simple-grid th {color:#bfcbd8 !important;font-weight:600;}
      #tax-panel #simple-grid button {font:inherit !important;}
    </style><p>Each week: $${cash.toLocaleString()} or ${items} ${escapeHtml(SETTINGS.taxItemName)} — cash and items can be combined.</p>
      <p>Showing ${escapeHtml(formatWeekHeader(visible[0]).fullStartLabel)} onward · ${visible.length} weeks (UTC). Ordinary payments count in the week received. Bulk payments check the previous ${period.requestedWeeks} weeks first, extending further if needed. Balances below cover only the displayed period.</p>
      <label><input type="checkbox" id="simple-unpaid"> Show staff with outstanding payments only</label>
      <div style="overflow:auto;margin-top:12px"><table id="simple-grid" style="width:100%;border-collapse:collapse;white-space:nowrap"><thead></thead><tbody></tbody></table></div><div id="simple-details" style="margin-top:16px"></div>`;
    const table = overviewView.querySelector('table');
    const header = table.querySelector('thead').insertRow();
    for (const label of ['Employee', ...visible.map(k => formatWeekHeader(k).startLabel), 'Period outstanding / credit', 'Last payment in period (UTC)']) {
      const th = document.createElement('th'); th.textContent = label; th.style.cssText = 'padding:10px;border-bottom:1px solid #555;text-align:left'; header.append(th);
    }
    for (const id of Object.keys(employees).sort((a, b) => getEmployeeName(employees[a]).localeCompare(getEmployeeName(employees[b])))) {
      const joined = getEmployeeJoinWeek(employees[id]) || getEmployeeJoinWeekFromDays(employees[id]);
      const joinKey = joined ? formatWeekKey(...joined) : null;
      const history = lastPaymentHistoryCache[id] || [];
      const adjustments = getMemberWriteOffs(id);
      const ledger = calculatePeriodLedger(period, history, cash, items, scanComplete, joinKey, adjustments);
      const row = table.querySelector('tbody').insertRow();
      row.dataset.owing = String(!scanComplete || ledger.owedWeeks > 1e-9);
      const cell = text => { const td = row.insertCell(); td.textContent = text; td.style.cssText = 'padding:10px;border-bottom:1px solid #444;color:#eee'; return td; };
      const nameCell = cell('');
      const nameLink = document.createElement('a');
      const employeeName = getEmployeeName(employees[id]) || id;
      nameLink.textContent = employeeName;
      nameLink.href = `https://www.torn.com/messages.php#/p=compose&XID=${encodeURIComponent(id)}`;
      nameLink.target = '_blank'; nameLink.rel = 'noopener noreferrer';
      nameLink.style.cssText = 'color:#91caff !important;text-decoration:underline;cursor:pointer';
      nameLink.title = 'Open a friendly payment reminder in Torn messages';
      nameLink.addEventListener('click', event => {
        if (!scanComplete || ledger.owedWeeks <= 1e-9) {
          event.preventDefault(); setStatus(!scanComplete ? 'Finish the payment scan before drafting an amount owed.' : `${employeeName} has no outstanding amount in this period.`, 'info'); return;
        }
        const draft = buildPaymentReminder(id, employeeName, ledger.owedWeeks, cash, items, SETTINGS.taxItemName, period);
        const token = crypto.randomUUID();
        try { localStorage.setItem('torn_tax_message_' + token, JSON.stringify(draft)); }
        catch { event.preventDefault(); setStatus('The reminder could not be saved. Check browser storage and try again.', 'error'); return; }
        nameLink.href = `https://www.torn.com/messages.php?taxDraft=${token}#/p=compose&XID=${encodeURIComponent(id)}`;
      });
      nameCell.append(nameLink);
      for (const key of visible) {
        const week = ledger.weeks.find(w => w.key === key);
        let label = week ? week.status : '—';
        if (key === current && scanComplete && week && week.status !== 'Paid') label = week.coverage > 0 ? 'Part paid · due' : 'Due this week';
        if (week && week.status === 'Paid' && week.writeOffCoverage > 0) label = week.writeOffCoverage >= 1 - 1e-9 ? 'Written off' : 'Paid · adjusted';
        const td = cell(''); const btn = document.createElement('button'); btn.textContent = label;
        btn.style.cssText = `color:${week && week.status === 'Paid' ? '#91e5ae' : label === 'Unpaid' ? '#ffb3b3' : '#e5dfad'};background:#292929;border:1px solid #555;border-radius:5px;padding:7px;cursor:pointer`;
        btn.addEventListener('click', () => showSimplePayments(id, key, employees)); td.append(btn);
      }
      cell(!scanComplete ? 'Unable to confirm' : ledger.creditWeeks > 1e-9 ? `${ledger.creditWeeks.toFixed(2)} weeks credit` : ledger.owedWeeks <= 1e-9 ? 'Paid up' : `$${Math.round(ledger.owedWeeks * cash).toLocaleString()} or ${(ledger.owedWeeks * items).toFixed(2)} ${SETTINGS.taxItemName}${visible.includes(current) ? ' (includes this week)' : ''}`);
      const adjust = document.createElement('button'); adjust.textContent = '⋯';
      adjust.title = `Write off tax / adjustments for ${employeeName}`;
      adjust.setAttribute('aria-label', adjust.title);
      adjust.style.cssText = 'display:inline-block !important;margin:0 0 0 8px !important;background:transparent !important;color:#aebdcb !important;border:0 !important;border-radius:4px;padding:2px 6px !important;cursor:pointer;font-size:18px !important;line-height:1 !important;vertical-align:middle';
      adjust.addEventListener('click', () => showWriteOffEditor(id, employeeName, ledger, period, cash));
      nameCell.append(adjust);
      const last = history.filter(p => !p.excluded && p.timestamp >= period.startUnix * 1000 && p.timestamp <= period.endUnix * 1000).sort((a, b) => b.timestamp - a.timestamp)[0];
      cell(last ? new Date(last.timestamp).toISOString().slice(0, 16).replace('T', ' ') : scanComplete ? 'None' : 'Unknown');
    }
    overviewView.querySelector('#simple-unpaid').addEventListener('change', event => {
      for (const row of table.querySelectorAll('tbody tr')) row.hidden = event.target.checked && row.dataset.owing === 'false';
    });
  }

  function showSimplePayments(id, key, employees) {
    const detail = overviewView.querySelector('#simple-details'); detail.replaceChildren();
    const heading = document.createElement('h3'); heading.textContent = `${getEmployeeName(employees[id])} · received week of ${formatWeekHeader(key).startLabel}`; detail.append(heading);
    const explanation = document.createElement('p'); explanation.textContent = 'These are actual receipts for this week. Ordinary payments count here; bulk payments and weekly excess can cover older unpaid weeks before becoming future credit.'; detail.append(explanation);
    const entries = (lastPaymentHistoryCache[id] || []).filter(p => p.weekKey === key);
    if (!entries.length) { const p = document.createElement('p'); p.textContent = scanComplete ? 'No payments received this week.' : 'No payments found in the history scanned so far.'; detail.append(p); }
    for (const entry of entries) {
      const p = document.createElement('p'); p.textContent = `${new Date(entry.timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC — ${entry.type === 'money' ? '$' + entry.amount.toLocaleString() : entry.amount + ' ' + SETTINGS.taxItemName}${entry.excluded ? ' (previously excluded)' : ''}`; detail.append(p);
    }
    for (const entry of getMemberWriteOffs(id).filter(entry => entry.weekKey === key)) {
      const p = document.createElement('p'); p.textContent = `Write-off: ${entry.coverage.toFixed(2)} week(s) · ${entry.reason || 'No note'} · recorded ${new Date(entry.createdAt).toISOString().slice(0,10)}. This is an adjustment, not a received payment.`; detail.append(p);
    }
  }

  function getMemberWriteOffs(id) {
    const entries = SETTINGS.writeOffs && SETTINGS.writeOffs[id];
    return Array.isArray(entries) ? entries : [];
  }

  function planWriteOff(weeks, amount, cashRate, fromWeek) {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(cashRate) || cashRate <= 0) throw new Error('Enter a positive cash amount.');
    let remaining = amount / cashRate;
    const plan = [];
    for (const week of weeks) {
      if (compareWeekKeys(week.key, fromWeek) < 0) continue;
      const coverage = Math.min(Math.max(0, 1 - week.coverage), remaining);
      if (coverage > 1e-9) { plan.push({weekKey:week.key,coverage}); remaining -= coverage; }
    }
    if (remaining > 1e-8) throw new Error('That amount exceeds the unpaid tax from the chosen week onward.');
    return plan;
  }

  function showWriteOffEditor(id, name, ledger, period, cashRate) {
    if (document.getElementById('tax-write-off')) return;
    const dialog = document.createElement('dialog'); dialog.id = 'tax-write-off';
    dialog.style.cssText = 'position:fixed;inset:16px;margin:auto;width:480px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;padding:24px;background:#1c2128;color:#eee;border:1px solid #596778;border-radius:12px;font:14px/1.5 system-ui';
    dialog.setAttribute('aria-labelledby','tax-write-off-title');
    dialog.innerHTML = `<style>
      #tax-write-off, #tax-write-off label, #tax-write-off p, #tax-write-off h2, #tax-write-off h3 {color:#eef2f6 !important;font-family:system-ui !important;}
      #tax-write-off {box-sizing:border-box;line-height:1.5 !important;}
      #tax-write-off h2 {margin:0 0 18px !important;font-size:22px !important;line-height:1.3 !important;}
      #tax-write-off #tax-write-off-person {margin:0 0 6px !important;font-weight:600;}
      #tax-write-off p {margin:0 0 18px !important;line-height:1.5 !important;}
      #tax-write-off label {display:block !important;clear:both !important;margin:0 0 16px !important;line-height:1.5 !important;}
      #tax-write-off input, #tax-write-off select {display:block !important;width:100% !important;min-height:40px;margin:6px 0 0 !important;}
      #tax-write-off #write-off-free-week {display:block !important;margin:0 0 18px !important;padding:8px 12px !important;}
      #tax-write-off .write-off-actions {display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 24px;}
      #tax-write-off .write-off-saved {border-top:1px solid #46515d;padding-top:18px;}
      #tax-write-off .write-off-saved h3 {margin:0 0 12px !important;font-size:16px !important;line-height:1.4 !important;}
      #tax-write-off #write-off-list {font-size:13px;color:#b9c4cf;}
      #tax-write-off #write-off-error:empty {display:none;}
      #tax-write-off input, #tax-write-off select {color:#fff !important;background:#141a21 !important;border:1px solid #718096 !important;border-radius:6px;box-sizing:border-box;font:14px system-ui;}
      #tax-write-off button {color:#fff !important;background:#303a46 !important;border:1px solid #718096 !important;border-radius:6px;font:13px system-ui;cursor:pointer;}
      #tax-write-off #write-off-save {background:#28784f !important;}
      #tax-write-off::backdrop {background:#0008;}
    </style><h2 id="tax-write-off-title" style="margin-top:0;color:white">Write off tax</h2><p id="tax-write-off-person"></p>
      <p>Reduces the selected person's obligation. It does not record a payment or create credit. Saved against specific weeks.</p>
      <label>Apply from week <select id="write-off-week" style="display:block;width:100%;margin:6px 0 14px;padding:9px;background:#141a21;color:white;border:1px solid #718096"></select></label>
      <label>Amount to write off ($)<input id="write-off-amount" type="number" min="1" step="1" style="display:block;box-sizing:border-box;width:100%;margin:6px 0;padding:9px;background:#141a21;color:white;border:1px solid #718096"></label>
      <button type="button" id="write-off-free-week" style="margin:6px 0 14px;padding:8px;color:white;background:#303a46;border:1px solid #718096">Use one free week</button>
      <label>Note<input id="write-off-note" maxlength="200" placeholder="e.g. Free week agreed" style="display:block;box-sizing:border-box;width:100%;margin:6px 0 14px;padding:9px;background:#141a21;color:white;border:1px solid #718096"></label>
      <p id="write-off-error" role="alert" style="color:#ffb3b3"></p>
      <div class="write-off-actions"><button type="button" id="write-off-save" style="padding:9px 14px;background:#28784f;color:white;border:1px solid #419d70;border-radius:6px">Save write-off</button>
      <button type="button" id="write-off-cancel" style="padding:9px 14px;background:#303a46;color:white;border:1px solid #718096;border-radius:6px">Close</button>
      </div><section class="write-off-saved"><h3 style="color:white">Saved adjustments</h3><div id="write-off-list"></div></section>`;
    dialog.querySelector('#tax-write-off-person').textContent = name;
    const select = dialog.querySelector('#write-off-week');
    for (const week of ledger.weeks) { const option = document.createElement('option'); option.value=week.key; option.textContent=formatWeekHeader(week.key).fullStartLabel; select.append(option); }
    select.value = ledger.weeks.find(week => week.coverage < 1 - 1e-9)?.key || period.weeks[0];
    dialog.querySelector('#write-off-free-week').onclick = () => { dialog.querySelector('#write-off-amount').value = cashRate; dialog.querySelector('#write-off-note').value = 'Free week'; };
    dialog.querySelector('#write-off-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('#write-off-save').onclick = () => {
      const error = dialog.querySelector('#write-off-error');
      if (fetching || !scanComplete) { error.textContent='Finish a complete payment refresh before writing off tax.'; return; }
      try {
        const input = dialog.querySelector('#write-off-amount');
        if (!input.checkValidity()) { input.reportValidity(); return; }
        const plan = planWriteOff(ledger.weeks,Number(input.value),cashRate,select.value);
        const createdAt=Date.now(), reason=dialog.querySelector('#write-off-note').value.trim();
        const previous = SETTINGS.writeOffs;
        SETTINGS.writeOffs = {...previous, [id]:getMemberWriteOffs(id).concat(plan.map(entry=>({...entry,id:crypto.randomUUID(),createdAt,reason,cashRateAtCreation:cashRate})))};
        try { saveSettings(SETTINGS); } catch (err) { SETTINGS.writeOffs=previous; throw err; }
        dialog.close(); renderOverview(lastWeeklyDataCache,lastEmployeesCache);
      } catch(err) { error.textContent=err.message; }
    };
    const list=dialog.querySelector('#write-off-list');
    for (const entry of getMemberWriteOffs(id)) {
      const row=document.createElement('p'); row.textContent=`${formatWeekHeader(entry.weekKey).startLabel}: ${entry.coverage.toFixed(2)} week(s) — ${entry.reason || 'No note'} `;
      const undo=document.createElement('button'); undo.textContent='Undo'; undo.style.cssText='padding:5px 9px;background:#303a46;color:white;border:1px solid #718096';
      undo.onclick=()=>{
        if(fetching) {dialog.querySelector('#write-off-error').textContent='Wait for the refresh to finish.';return;}
        const previous=SETTINGS.writeOffs;
        SETTINGS.writeOffs={...previous,[id]:getMemberWriteOffs(id).filter(saved=>saved.id!==entry.id)};
        try {saveSettings(SETTINGS);} catch(err) {SETTINGS.writeOffs=previous;dialog.querySelector('#write-off-error').textContent=err.message;return;}
        dialog.close();renderOverview(lastWeeklyDataCache,lastEmployeesCache);
      };
      row.append(undo);list.append(row);
    }
    if(!list.children.length) list.textContent='No adjustments saved.';
    document.body.append(dialog); dialog.showModal();
  }

  function buildPaymentReminder(id, name, owedWeeks, cashRate, itemRate, itemName, period) {
    const cash = Math.ceil(owedWeeks * cashRate - 1e-8);
    const items = (owedWeeks * itemRate).toFixed(2).replace(/\.00$/,'');
    const start = new Date(period.startUnix * 1000).toISOString().slice(0,10);
    const end = new Date(period.endUnix * 1000).toISOString().slice(0,10);
    return {recipient:String(id), name, createdAt:Date.now(), title:'Friendly company tax reminder',
      body:`Hi ${name},\n\nHope you're doing well! Just a friendly reminder that the tracker currently shows $${cash.toLocaleString()} outstanding for ${start} to ${end}\n\nWhen you get a chance, could you please catch up? If you've already paid or something looks wrong, let me know and I'll check it.\n\nThanks!`};
  }

  function installPaymentReminderDraft() {
    if (reminderDraftTimer) clearInterval(reminderDraftTimer);
    document.getElementById('tax-reminder-preview')?.remove();
    if (location.pathname !== '/messages.php') return;
    const route = new URLSearchParams(location.hash.replace(/^#\/?/,''));
    const token = new URLSearchParams(location.search).get('taxDraft') || route.get('taxDraft');
    if (route.get('p') !== 'compose' || !/^[a-f0-9-]{36}$/i.test(token || '')) return;
    let draft;
    try { draft = JSON.parse(localStorage.getItem('torn_tax_message_' + token)); } catch { return; }
    if (!draft || draft.recipient !== route.get('XID') || typeof draft.body !== 'string' || typeof draft.title !== 'string' || !Number.isFinite(draft.createdAt) || Date.now() - draft.createdAt > 30 * 60 * 1000) return;
    const preview = document.createElement('section'); preview.id = 'tax-reminder-preview';
    preview.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:360px;max-width:calc(100vw - 32px);max-height:45vh;overflow:auto;box-sizing:border-box;padding:16px;background:#1c2128;color:white;border:1px solid #718096;border-radius:10px;font:13px/1.5 system-ui;box-shadow:0 8px 30px #0008';
    const title=document.createElement('strong');title.textContent=`Tax reminder for ${draft.name} [${draft.recipient}]`;preview.append(title);
    const status=document.createElement('p');status.textContent='Waiting for Torn’s composer. Review the recipient and text before sending.';preview.append(status);
    const subject=document.createElement('p');subject.textContent='Subject: '+draft.title;preview.append(subject);
    const text=document.createElement('textarea');text.value=draft.body;text.readOnly=true;text.style.cssText='width:100%;box-sizing:border-box;min-height:110px;background:#141a21;color:white;padding:8px;border:1px solid #718096';preview.append(text);
    const copy=document.createElement('button');copy.textContent='Copy reminder';copy.style.cssText='padding:7px 10px;background:#303a46;color:white;border:1px solid #718096;border-radius:5px';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(draft.body);status.textContent='Reminder copied. Paste it into Torn’s message editor.';}catch{text.focus();text.select();status.textContent='Press Ctrl+C to copy the selected reminder.';}};preview.append(copy);
    const close=document.createElement('button');close.textContent='Close preview';close.style.cssText=copy.style.cssText+';margin-left:8px';close.onclick=()=>{clearInterval(reminderDraftTimer);preview.remove();};preview.append(close);
    document.body.append(preview);
    let attempts=0;
    const fill = () => {
      if (Date.now() - draft.createdAt > 30 * 60 * 1000) {clearInterval(reminderDraftTimer);status.textContent='This reminder draft has expired. Create a fresh one from the tracker.';return;}
      if (document.visibilityState !== 'visible') return;
      const currentRoute = new URLSearchParams(location.hash.replace(/^#\/?/,''));
      if (currentRoute.get('p') !== 'compose' || currentRoute.get('XID') !== draft.recipient || ++attempts > 40) {
        clearInterval(reminderDraftTimer);status.textContent='Use Copy reminder if Torn’s editor could not be filled.';return;
      }
      const root=document.querySelector('form#editor-form') || document;
      const visible=selector=>[...root.querySelectorAll(selector)].find(el=>el.getClientRects().length && !preview.contains(el));
      const subject=visible('input.subject, input[name="subject"], input[placeholder*="subject" i]');
      const body=visible('[id^="mce_"][contenteditable="true"], [contenteditable="true"][role="textbox"], textarea[name="message"]');
      if (!subject || !body) return;
      const currentBody=(body.value ?? body.innerText ?? body.textContent ?? '').trim();
      if ((subject.value.trim() && subject.value !== draft.title) || (currentBody && currentBody !== draft.body.trim())) {
        clearInterval(reminderDraftTimer);status.textContent='Existing message text was kept. Use Copy reminder if you want to replace it.';return;
      }
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(subject,draft.title);
      subject.dispatchEvent(new Event('input',{bubbles:true}));subject.dispatchEvent(new Event('change',{bubbles:true}));
      const richEditor=window.tinymce?.get?.(body.id);
      if (richEditor) {richEditor.setContent(escapeHtml(draft.body).replace(/\n/g,'<br>'));richEditor.fire('change');richEditor.save();}
      else if (body.tagName==='TEXTAREA') Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(body,draft.body);
      else {body.textContent=draft.body;body.style.whiteSpace='pre-wrap';}
      body.dispatchEvent(new Event('input',{bubbles:true}));body.dispatchEvent(new Event('change',{bubbles:true}));
      clearInterval(reminderDraftTimer);status.textContent='Reminder filled. Check the recipient and wording, then send it yourself in Torn.';
    };
    reminderDraftTimer=setInterval(fill,500);fill();
  }

  function renderPaymentHistory(paymentHistory, COMPANY_MEMBERS) {
    if (!paymentsView) {
      return;
    }

    const employeeIds = Object.keys(COMPANY_MEMBERS || {});
    if (employeeIds.length === 0) {
      paymentsView.innerHTML = '<p style="color:#ccc;">No employees loaded yet. Fetch data to view payment history.</p>';
      return;
    }

    const sortedIds = employeeIds.sort((a, b) => {
      const nameA = getEmployeeName(COMPANY_MEMBERS[a] || {}).toLowerCase();
      const nameB = getEmployeeName(COMPANY_MEMBERS[b] || {}).toLowerCase();
      if (nameA === nameB) {
        return a.localeCompare(b);
      }
      return nameA.localeCompare(nameB);
    });

    const dueDayName = WEEKDAY_NAMES[Number(SETTINGS.paymentDueWeekday) || 0] || WEEKDAY_NAMES[0];
    let html = '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px;">';
    html += '<div style="color:#ccc;font-size:11px;flex:1 1 260px;">Entries use your local timezone. Payments are shown from the configured start week or the employee\'s join week, whichever is later. Carryback adjustments may display earlier weeks.</div>';
    html += `<span style="background:#1f3552;color:#9fd3ff;border:1px solid #35598a;border-radius:999px;padding:4px 10px;font-size:11px;">Due day: ${escapeHtml(dueDayName)}</span>`;
    html += `<span style="background:#2b2b2b;color:#ddd;border:1px solid #444;border-radius:999px;padding:4px 10px;font-size:11px;">Next due: ${escapeHtml(getNextDueDateLabel())}</span>`;
    html += '<button id="refreshPayments" style="background:#2e8b57;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">Refresh payments</button>';
    html += '</div>';
    html += '<div style="display:flex;flex-direction:column;gap:12px;">';

    sortedIds.forEach(id => {
      const employeeRecord = COMPANY_MEMBERS[id] || {};
      const employeeName = getEmployeeName(employeeRecord) || 'Unknown';
      const joinWeekFromDays = getEmployeeJoinWeekFromDays(employeeRecord);
      const joinWeek = joinWeekFromDays || getEmployeeJoinWeek(employeeRecord);
      const joinWeekKey = Array.isArray(joinWeek) ? formatWeekKey(joinWeek[0], joinWeek[1]) : null;
      const startKey = `${SETTINGS.startYear}-W${SETTINGS.startWeek}`;

      let baselineKey = startKey;
      if (typeof joinWeekKey === 'string' && parseWeekKey(joinWeekKey) && compareWeekKeys(joinWeekKey, baselineKey) > 0) {
        baselineKey = joinWeekKey;
      }

      const carrybacks = getWeekCarrybacksForMember(id);
      Object.values(carrybacks).forEach(targetWeek => {
        if (typeof targetWeek === 'string' && parseWeekKey(targetWeek) && compareWeekKeys(targetWeek, baselineKey) < 0) {
          baselineKey = targetWeek;
        }
      });

      const entries = (paymentHistory && paymentHistory[id] ? paymentHistory[id] : []).filter(entry => {
        if (!entry || typeof entry.weekKey !== 'string') {
          return false;
        }
        if (!baselineKey) {
          return true;
        }
        return compareWeekKeys(entry.weekKey, baselineKey) >= 0;
      });

      let moneyTotal = 0;
      let itemTotal = 0;
      entries.forEach(entry => {
        if (!entry) {
          return;
        }
        if (entry.type === 'money' && Number.isFinite(entry.amount)) {
          moneyTotal += entry.amount;
        } else if (entry.type === 'item' && Number.isFinite(entry.amount)) {
          itemTotal += entry.amount;
        }
      });

      html += '<div style="padding:12px;border:1px solid #333;border-radius:6px;background:#1f1f1f;color:#ddd;">';
      html += `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">`;
      html += `<strong style="color:#fff;font-size:13px;">${escapeHtml(employeeName)} [${escapeHtml(id)}]</strong>`;
      html += `<span style="color:#888;font-size:11px;">Showing payments since ${escapeHtml(baselineKey)}</span>`;
      html += '</div>';

      if (entries.length === 0) {
        html += '<div style="color:#888;margin-top:8px;">No payments recorded during this period.</div>';
      } else {
        const weeklyRollup = {};
        entries.forEach(entry => {
          const wk = entry.weekKey || 'Unknown';
          if (!weeklyRollup[wk]) {
            weeklyRollup[wk] = { money: 0, items: 0, counted: 0 };
          }
          if (!entry.excluded) {
            weeklyRollup[wk].counted += 1;
            if (entry.type === 'money') {
              weeklyRollup[wk].money += Number(entry.amount) || 0;
            } else if (entry.type === 'item') {
              weeklyRollup[wk].items += Number(entry.amount) || 0;
            }
          }
        });
        const req = getMemberRequirement(id);
        const rollupWeeks = Object.keys(weeklyRollup).sort(compareWeekKeys);
        html += '<div style="margin-top:8px;padding:8px;border:1px solid #333;border-radius:6px;background:#181818;color:#ddd;">';
        html += '<div style="color:#bbb;font-size:11px;margin-bottom:6px;">Weekly method summary (auto-detected from logs):</div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
        html += '<thead><tr style="background:#262626;color:#ddd;">';
        html += '<th style="padding:5px;border:1px solid #333;text-align:left;color:#ddd;">Week</th><th style="padding:5px;border:1px solid #333;text-align:left;color:#ddd;">Money</th><th style="padding:5px;border:1px solid #333;text-align:left;color:#ddd;">Xanax</th><th style="padding:5px;border:1px solid #333;text-align:left;color:#ddd;">Detected</th><th style="padding:5px;border:1px solid #333;text-align:left;color:#ddd;">Status</th>';
        html += '</tr></thead><tbody>';
        rollupWeeks.forEach(weekKey => {
          const wk = weeklyRollup[weekKey];
          const method = wk.money > 0 && wk.items > 0 ? 'Mixed' : wk.money > 0 ? 'Money' : wk.items > 0 ? SETTINGS.taxItemName : 'None';
          let met = false;
          if (req.type === 'item') {
            met = wk.items >= req.amount;
          } else {
            met = wk.money >= req.amount;
          }
          const status = met ? '<span style="color:#66ff66;">Met</span>' : '<span style="color:#ff9999;">Not met</span>';
          html += '<tr style="background:#1d1d1d;color:#ccc;">';
          html += `<td style="padding:5px;border:1px solid #333;color:#ddd;">${escapeHtml(weekKey)}</td>`;
          html += `<td style="padding:5px;border:1px solid #333;color:#ddd;">$${(wk.money || 0).toLocaleString()}</td>`;
          html += `<td style="padding:5px;border:1px solid #333;color:#ddd;">${(wk.items || 0).toLocaleString()}</td>`;
          html += `<td style="padding:5px;border:1px solid #333;color:#ddd;">${escapeHtml(method)}</td>`;
          html += `<td style="padding:5px;border:1px solid #333;color:#ddd;">${status}</td>`;
          html += '</tr>';
        });
        html += '</tbody></table></div>';

        html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">';
        html += '<thead><tr style="background:#2a2a2a;color:#fff;font-weight:bold;">';
        html += '<th style="padding:6px;border:1px solid #333;text-align:left;">Date</th>';
        html += '<th style="padding:6px;border:1px solid #333;text-align:left;">Week</th>';
        html += '<th style="padding:6px;border:1px solid #333;text-align:left;">Type</th>';
        html += '<th style="padding:6px;border:1px solid #333;text-align:left;">Amount</th>';
        html += '<th style="padding:6px;border:1px solid #333;text-align:left;">Details</th>';
        html += '<th style="padding:6px;border:1px solid #333;text-align:left;">Counted?</th>';
        html += '<th style="padding:6px;border:1px solid #333;text-align:left;">Action</th>';
        html += '</tr></thead><tbody>';

        entries.forEach((entry, index) => {
          const baseBg = index % 2 === 0 ? '#1b1b1b' : '#242424';
          const excluded = !!entry.excluded;
          const rowBg = excluded ? '#2a1919' : baseBg;
          const dateLabel = formatTimestamp(entry.timestamp) || 'Unknown';
          const weekLabel = entry.weekKey || '—';
          const typeLabel = entry.type === 'item' ? `${SETTINGS.taxItemName}` : 'Money';
          const amountLabel = entry.type === 'item'
            ? `${(Number.isFinite(entry.amount) ? entry.amount : 0).toLocaleString()} ${SETTINGS.taxItemName}`
            : `$${Number.isFinite(entry.amount) ? entry.amount.toLocaleString() : '0'}`;
          const detailsLabel = entry.medium ? escapeHtml(entry.medium) : '';
          const textColor = excluded ? '#ffaaaa' : '#ccc';
          const paymentId = entry && (entry.id || entry.logId)
            ? String(entry.id || entry.logId)
            : `${entry.weekKey || 'unknown'}-${entry.type || 'unknown'}-${entry.timestamp || index}`;
          if (entry && !entry.id) {
            entry.id = paymentId;
          }
          const countedLabel = excluded ? '<span style="color:#ff6666;">No</span>' : '<span style="color:#66ff66;">Yes</span>';
          const actionLabel = excluded ? 'Include' : 'Exclude';
          const actionBg = excluded ? '#2e8b57' : '#b34747';
          const actionTitle = excluded ? 'Include this payment in tax totals' : 'Exclude this payment from tax totals';
          const buttonStyle = `background:${actionBg};color:white;border:none;padding:4px 8px;border-radius:4px;cursor:${paymentId ? 'pointer' : 'not-allowed'};`;
          html += `<tr style="background:${rowBg};color:${textColor};">`;
          html += `<td style="padding:6px;border:1px solid #333;color:${textColor};">${escapeHtml(dateLabel)}</td>`;
          html += `<td style="padding:6px;border:1px solid #333;color:${textColor};">${escapeHtml(weekLabel)}</td>`;
          html += `<td style="padding:6px;border:1px solid #333;color:${textColor};">${escapeHtml(typeLabel)}</td>`;
          html += `<td style="padding:6px;border:1px solid #333;color:${textColor};">${escapeHtml(amountLabel)}</td>`;
          html += `<td style="padding:6px;border:1px solid #333;color:${textColor};">${detailsLabel || '<span style="color:#888;">&mdash;</span>'}</td>`;
          html += `<td style="padding:6px;border:1px solid #333;color:${textColor};">${countedLabel}</td>`;
          if (paymentId) {
            html += `<td style="padding:6px;border:1px solid #333;color:${textColor};">
              <button class="toggle-payment-exclusion" data-employee="${escapeHtml(String(id))}" data-payment="${escapeHtml(paymentId)}" data-excluded="${excluded}" title="${escapeHtml(actionTitle)}" style="${buttonStyle}">${escapeHtml(actionLabel)}</button>
            </td>`;
          } else {
            html += '<td style="padding:6px;border:1px solid #333;color:#888;">Unavailable</td>';
          }
          html += '</tr>';
        });

        html += '</tbody></table>';
        if (moneyTotal > 0 || itemTotal > 0) {
          const totals = [];
          if (moneyTotal > 0) {
            totals.push(`Money: $${moneyTotal.toLocaleString()}`);
          }
          if (itemTotal > 0) {
            totals.push(`${SETTINGS.taxItemName}: ${itemTotal.toLocaleString()}`);
          }
          html += `<div style="margin-top:8px;color:#ccc;font-size:12px;">Totals since ${escapeHtml(baselineKey)} — ${escapeHtml(totals.join('; '))}</div>`;
        }
      }

      html += '</div>';
    });

    html += '</div>';
    paymentsView.innerHTML = html;

    paymentsView.querySelectorAll('.toggle-payment-exclusion').forEach(button => {
      button.addEventListener('click', () => {
        const employeeId = button.getAttribute('data-employee');
        const paymentId = button.getAttribute('data-payment');
        const currentlyExcluded = button.getAttribute('data-excluded') === 'true';
        const nextExcluded = !currentlyExcluded;
        setPaymentExcluded(employeeId, paymentId, nextExcluded);
        saveSettings(SETTINGS);
        applyPaymentExclusion(employeeId, paymentId, nextExcluded);
      });
    });
    const refreshButton = paymentsView.querySelector('#refreshPayments');
    if (refreshButton) {
      refreshButton.addEventListener('click', async () => {
        refreshButton.disabled = true;
        const originalText = refreshButton.textContent;
        refreshButton.textContent = 'Refreshing...';
        try {
          await fetchData();
        } finally {
          refreshButton.disabled = false;
          refreshButton.textContent = originalText;
        }
      });
    }
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

    const rows = ids.sort((a, b) => getEmployeeName(employees[a]).localeCompare(getEmployeeName(employees[b]))).map(id => {
      const stored = SETTINGS.memberRequirements[id];
      const req = getMemberRequirement(id);
      const isCustom = stored ? !stored.useDefault : false;
      const selectedMoney = req.type === 'item' ? '' : 'selected';
      const selectedItem = req.type === 'item' ? 'selected' : '';
      const disabledAttr = isCustom ? '' : 'disabled';
      return `
        <tr>
          <td style="padding:6px;border:1px solid #444;text-align:left;color:#fff;">${getEmployeeName(employees[id])} [${id}]</td>
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
        const toggles = Array.from(employeeView.querySelectorAll('.emp-use-custom'));
        const previousRequirements = {};
        toggles.forEach(box => {
          const id = box.getAttribute('data-id');
          previousRequirements[id] = getMemberRequirement(id);
        });

        toggles.forEach(box => {
          const id = box.getAttribute('data-id');
          const prev = previousRequirements[id] || getDefaultRequirement();
          let nextRequirement;
          if (!box.checked) {
            const defaults = getDefaultRequirement();
            SETTINGS.memberRequirements[id] = { type: defaults.type, amount: defaults.amount, useDefault: true };
            nextRequirement = defaults;
            delete SETTINGS.memberRequirementResets[id];
          } else {
            const select = types ? Array.from(types).find(sel => sel.getAttribute('data-id') === id) : null;
            const amountInput = amounts ? Array.from(amounts).find(input => input.getAttribute('data-id') === id) : null;
            const type = select && select.value === 'item' ? 'item' : 'money';
            const amountValue = amountInput ? parseInt(amountInput.value, 10) : NaN;
            const fallback = type === 'money' ? SETTINGS.defaultMoneyTax : SETTINGS.defaultItemTax;
            const normalizedAmount = isNaN(amountValue) ? fallback : amountValue;
            SETTINGS.memberRequirements[id] = {
              type,
              amount: normalizedAmount,
              useDefault: false
            };
            nextRequirement = { type, amount: normalizedAmount, isDefault: false };
          }
          if (!nextRequirement) {
            nextRequirement = getMemberRequirement(id);
          }
          if (!prev || prev.type !== nextRequirement.type || prev.amount !== nextRequirement.amount || (!!prev.isDefault) !== (!!nextRequirement.isDefault)) {
            SETTINGS.memberRequirementResets[id] = getCurrentWeekKey();
          }
        });
        saveSettings(SETTINGS);
        renderOverview(lastWeeklyDataCache, lastEmployeesCache);
        renderEmployeeMenu(employees);
        renderPaymentHistory(lastPaymentHistoryCache, lastEmployeesCache);
        alert('Employee requirements saved.');
      });
    }
  }

  function safe(obj, path) {
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  }

  function describeLogMedium(log) {
    if (!log || typeof log !== 'object') {
      return 'Log Entry';
    }
    const type = Number(log.log);
    const category = Number(log.category);
    if (type === 4800) {
      return 'Money transfer to company';
    }
    if (type === 4810) {
      return 'Company trade payment';
    }
    if (type === 4102) {
      return 'Trade sent items';
    }
    if (type === 4103) {
      return 'Trade received items';
    }
    if (category === 85) {
      return 'Item delivery to company';
    }
    const details = [];
    const title = typeof log.title === 'string' ? log.title.trim() : '';
    if (title) {
      details.push(title);
    }
    const description = typeof log.description === 'string' ? log.description.trim() : '';
    if (description) {
      details.push(description);
    }
    const dataFields = ['note', 'message', 'reason', 'description', 'summary', 'detail'];
    dataFields.forEach(field => {
      const value = log?.data ? log.data[field] : undefined;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          details.push(trimmed);
        }
      }
    });
    if (details.length === 0 && Number.isFinite(type)) {
      details.push(`Log ${type}`);
    }
    const unique = Array.from(new Set(details.filter(Boolean)));
    return unique.length > 0 ? unique.join(' — ') : 'Log Entry';
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
    Object.entries(employees || {}).forEach(([id, record]) => {
      const name = getEmployeeName(record);
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
    const fields = [
      'data.money', 'data.amount', 'data.cash', 'data.money_received',
      'data.received', 'data.transferred', 'data.transfer_amount',
      'data.deposit', 'data.deposited'
    ];
    for (const path of fields) {
      const value = safe(log, path);
      if (value !== undefined) {
        const num = parsePositiveAmount(value);
        if (Number.isFinite(num) && num > 0) {
          return num;
        }
      }
    }
    return findPositiveNumberByKeys(log && log.data, fields.map(field => field.replace(/^data\./, '')));
  }

  function findPositiveNumberByKeys(object, acceptedKeys) {
    let found = 0;
    const accepted = new Set(acceptedKeys.map(key => String(key).toLowerCase()));

    function walk(value) {
      if (found > 0 || !value || typeof value !== 'object') {
        return;
      }
      if (!Array.isArray(value)) {
        Object.keys(value).some(key => {
          if (!accepted.has(String(key).toLowerCase())) {
            return false;
          }
          const number = parsePositiveAmount(value[key]);
          if (Number.isFinite(number) && number > 0) {
            found = number;
            return true;
          }
          return false;
        });
      }
      Object.keys(value).forEach(key => walk(value[key]));
    }

    walk(object);
    return found;
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

        if (normalizedTargetId !== undefined) {
          Object.keys(value).forEach(key => {
            if (normalizeItemId(key) !== normalizedTargetId) {
              return;
            }
            const entry = value[key];
            if (entry && typeof entry === 'object') {
              const quantityFields = ['quantity', 'qty', 'amount', 'q', 'count', 'number', 'total', 'value'];
              const quantity = quantityFields.map(field => extractQuantity(entry[field])).find(q => q !== undefined);
              subtotal += quantity !== undefined && quantity > 0 ? quantity : 1;
            } else {
              const quantity = extractQuantity(entry);
              subtotal += quantity !== undefined && quantity > 0 ? quantity : 1;
            }
          });
        }

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

  function buildPaymentHistoryFromAggregates(weeklyData) {
    const history = {};
    if (!weeklyData || typeof weeklyData !== 'object') {
      return history;
    }
    Object.keys(weeklyData).forEach(weekKey => {
      const perEmployee = weeklyData[weekKey];
      if (!perEmployee || typeof perEmployee !== 'object') {
        return;
      }
      const baseDate = getDateFromWeekKey(weekKey);
      const baseTime = baseDate ? baseDate.getTime() : Date.now();
      Object.keys(perEmployee).forEach(employeeId => {
        const totals = perEmployee[employeeId] || {};
        if (!history[employeeId]) {
          history[employeeId] = [];
        }
        if (Number.isFinite(totals.money) && totals.money > 0) {
          const paymentId = `test-${employeeId}-${weekKey}-money`;
          const excluded = isPaymentExcluded(employeeId, paymentId);
          history[employeeId].push({
            id: paymentId,
            timestamp: baseTime,
            weekKey,
            type: 'money',
            amount: totals.money,
            medium: 'Simulated payment (Test Mode)',
            excluded
          });
        }
        if (Number.isFinite(totals.items) && totals.items > 0) {
          const paymentId = `test-${employeeId}-${weekKey}-item`;
          const excluded = isPaymentExcluded(employeeId, paymentId);
          history[employeeId].push({
            id: paymentId,
            timestamp: baseTime + 60000,
            weekKey,
            type: 'item',
            amount: totals.items,
            medium: 'Simulated item delivery (Test Mode)',
            excluded
          });
        }
      });
    });
    Object.keys(history).forEach(id => {
      history[id].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    });
    return history;
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

  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).replace(/[&<>'"]/g, ch => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return ch;
      }
    });
  }

})();
