/**
 * Fitbit Web API Integration
 * Uses Implicit Grant Flow (client-side only, no backend needed)
 * 
 * Setup: Enter your client_id in config.json or via the setup screen.
 * Register app at https://dev.fitbit.com/apps — type: "Personal" or "Client"
 * Set redirect URI to your GitHub Pages URL (e.g. https://digievolabs.github.io/fitness-dashboard/)
 */

const FitbitAPI = (() => {
  const AUTH_URL = 'https://www.fitbit.com/oauth2/authorize';
  const API_BASE = 'https://api.fitbit.com';
  const STORAGE_TOKEN = 'fitbit_access_token';
  const STORAGE_USER = 'fitbit_user_id';
  const STORAGE_EXPIRES = 'fitbit_token_expires';
  const STORAGE_CONFIG = 'fitbit_config';
  const STORAGE_CACHE = 'fitbit_data_cache';

  const DEFAULT_SCOPES = 'activity heartrate sleep weight profile oxygen_saturation respiratory_rate temperature cardio_fitness';

  // ── Config ──
  function getConfig() {
    const stored = localStorage.getItem(STORAGE_CONFIG);
    if (stored) {
      try { return JSON.parse(stored); } catch(e) {}
    }
    return null;
  }

  function saveConfig(clientId, redirectUri) {
    const config = { client_id: clientId, redirect_uri: redirectUri || window.location.origin + window.location.pathname };
    localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config));
    return config;
  }

  // ── Auth ──
  function getToken() {
    const token = localStorage.getItem(STORAGE_TOKEN);
    const expires = localStorage.getItem(STORAGE_EXPIRES);
    if (token && expires && Date.now() < parseInt(expires)) {
      return token;
    }
    // Token expired or missing
    if (token) {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
      localStorage.removeItem(STORAGE_EXPIRES);
    }
    return null;
  }

  function getUserId() {
    return localStorage.getItem(STORAGE_USER);
  }

  function isAuthenticated() {
    return !!getToken();
  }

  function startAuth() {
    const config = getConfig();
    if (!config || !config.client_id) {
      throw new Error('No client_id configured. Set it in config.json or via setup screen.');
    }
    const redirectUri = config.redirect_uri || window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      response_type: 'token',
      client_id: config.client_id,
      redirect_uri: redirectUri,
      scope: DEFAULT_SCOPES,
      expires_in: '2592000', // 30 days
    });
    window.location.href = `${AUTH_URL}?${params.toString()}`;
  }

  function handleCallback() {
    // Implicit flow returns token in URL fragment
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return false;

    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('access_token');
    const userId = params.get('user_id');
    const expiresIn = parseInt(params.get('expires_in') || '86400');

    if (token) {
      localStorage.setItem(STORAGE_TOKEN, token);
      if (userId) localStorage.setItem(STORAGE_USER, userId);
      localStorage.setItem(STORAGE_EXPIRES, String(Date.now() + expiresIn * 1000));
      // Clean up URL
      history.replaceState(null, '', window.location.pathname);
      return true;
    }
    return false;
  }

  function logout() {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem(STORAGE_EXPIRES);
    localStorage.removeItem(STORAGE_CACHE);
  }

  // ── API Fetch ──
  async function apiFetch(path, opts = {}) {
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        ...opts.headers,
      },
      ...opts,
    });

    if (res.status === 401) {
      logout();
      throw new Error('Token expired. Please re-authenticate.');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  // ── Data Cache ──
  function getCachedData() {
    const cached = localStorage.getItem(STORAGE_CACHE);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        // Cache valid for 15 minutes
        if (data._ts && Date.now() - data._ts < 15 * 60 * 1000) {
          return data;
        }
      } catch(e) {}
    }
    return null;
  }

  function setCachedData(data) {
    data._ts = Date.now();
    localStorage.setItem(STORAGE_CACHE, JSON.stringify(data));
  }

  // ── Helpers ──
  function today() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  // ── Data Fetchers ──
  async function fetchAllData() {
    // Check cache first
    const cached = getCachedData();
    if (cached) return cached;

    const d = today();
    const weekAgo = daysAgo(7);
    const userId = getUserId() || '-';

    // Fetch all endpoints in parallel
    const [
      profile,
      activitySummary,
      steps7d,
      heartDay,
      heartRest,
      sleepDay,
      weight,
      spo2,
      brRate,
      tempSkin,
      cardioScore,
      activityGoals,
    ] = await Promise.allSettled([
      apiFetch(`/1/user/${userId}/profile.json`),
      apiFetch(`/1/user/${userId}/activities/date/${d}.json`),
      apiFetch(`/1/user/${userId}/activities/steps/date/${d}/7d.json`),
      apiFetch(`/1/user/${userId}/activities/heart/date/${d}/1d.json`),
      apiFetch(`/1/user/${userId}/activities/heart/date/${d}/7d.json`),
      apiFetch(`/1.2/user/${userId}/sleep/date/${d}.json`),
      apiFetch(`/1/user/${userId}/body/log/weight/date/${d}/30d.json`),
      apiFetch(`/1/user/${userId}/spo2/date/${d}.json`),
      apiFetch(`/1/user/${userId}/br/date/${d}.json`),
      apiFetch(`/1/user/${userId}/temp/skin/date/${d}.json`),
      apiFetch(`/1/user/${userId}/cardioscore/date/${d}.json`),
      apiFetch(`/1/user/${userId}/activities/goals/daily.json`),
    ]);

    const data = {
      profile: profile.status === 'fulfilled' ? profile.value : null,
      activity: activitySummary.status === 'fulfilled' ? activitySummary.value : null,
      steps7d: steps7d.status === 'fulfilled' ? steps7d.value : null,
      heartDay: heartDay.status === 'fulfilled' ? heartDay.value : null,
      heartRest: heartRest.status === 'fulfilled' ? heartRest.value : null,
      sleep: sleepDay.status === 'fulfilled' ? sleepDay.value : null,
      weight: weight.status === 'fulfilled' ? weight.value : null,
      spo2: spo2.status === 'fulfilled' ? spo2.value : null,
      brRate: brRate.status === 'fulfilled' ? brRate.value : null,
      tempSkin: tempSkin.status === 'fulfilled' ? tempSkin.value : null,
      cardioScore: cardioScore.status === 'fulfilled' ? cardioScore.value : null,
      goals: activityGoals.status === 'fulfilled' ? activityGoals.value : null,
    };

    setCachedData(data);
    return data;
  }

  // ── Data Extraction (normalize API responses → dashboard values) ──
  function extractDashboardData(raw) {
    const d = {};

    // Profile
    if (raw.profile?.user) {
      const u = raw.profile.user;
      d.displayName = u.displayName;
      d.avatar = u.avatar150;
      d.memberSince = u.memberSince;
    }

    // Activity summary
    if (raw.activity?.summary) {
      const s = raw.activity.summary;
      d.steps = s.steps || 0;
      d.distance = (s.distances?.find(x => x.activity === 'total')?.distance || 0);
      d.floors = s.floors || 0;
      d.calories = s.caloriesOut || 0;
      d.activeMinutes = (s.fairlyActiveMinutes || 0) + (s.veryActiveMinutes || 0);
      d.sedentaryMinutes = s.sedentaryMinutes || 0;
      d.lightlyActiveMinutes = s.lightlyActiveMinutes || 0;
      d.fairlyActiveMinutes = s.fairlyActiveMinutes || 0;
      d.veryActiveMinutes = s.veryActiveMinutes || 0;
      d.activityCalories = s.activityCalories || 0;
      d.marginalCalories = s.marginalCalories || 0;

      // Heart rate zones
      d.heartRateZones = s.heartRateZones || [];
      d.restingHeartRate = s.restingHeartRate || null;

      // Elevation
      d.elevation = s.elevation || 0;
    }

    // Goals
    if (raw.goals?.goals) {
      const g = raw.goals.goals;
      d.stepsGoal = g.steps || 10000;
      d.distanceGoal = g.distance || 8;
      d.floorsGoal = g.floors || 10;
      d.caloriesGoal = g.caloriesOut || 2000;
      d.activeMinutesGoal = g.activeMinutes || 30;
    }

    // Steps 7-day
    if (raw.steps7d?.['activities-steps']) {
      d.stepsWeek = raw.steps7d['activities-steps'].map(x => parseInt(x.value) || 0);
    }

    // Heart rate
    if (raw.heartDay?.['activities-heart']?.[0]?.value) {
      const hv = raw.heartDay['activities-heart'][0].value;
      d.restingHeartRate = d.restingHeartRate || hv.restingHeartRate || null;
      d.heartRateZones = hv.heartRateZones || d.heartRateZones;
    }

    // Resting HR 7-day
    if (raw.heartRest?.['activities-heart']) {
      d.restingHR7d = raw.heartRest['activities-heart']
        .map(x => x.value?.restingHeartRate || 0)
        .filter(x => x > 0);
    }

    // Sleep
    if (raw.sleep?.summary) {
      const ss = raw.sleep.summary;
      d.sleepDuration = ss.totalMinutesAsleep || 0;
      d.sleepTimeInBed = ss.totalTimeInBed || 0;
      d.sleepStages = ss.stages || null; // {deep, light, rem, wake}
    }
    if (raw.sleep?.sleep?.[0]) {
      const mainSleep = raw.sleep.sleep.find(s => s.isMainSleep) || raw.sleep.sleep[0];
      d.sleepStartTime = mainSleep.startTime;
      d.sleepEndTime = mainSleep.endTime;
      d.sleepEfficiency = mainSleep.efficiency;
      if (mainSleep.levels?.summary) {
        d.sleepStages = {
          deep: mainSleep.levels.summary.deep?.minutes || 0,
          light: mainSleep.levels.summary.light?.minutes || 0,
          rem: mainSleep.levels.summary.rem?.minutes || 0,
          wake: mainSleep.levels.summary.wake?.minutes || 0,
        };
      }
    }

    // Weight
    if (raw.weight?.weight?.length > 0) {
      const weights = raw.weight.weight;
      const latest = weights[weights.length - 1];
      d.weight = latest.weight;
      d.bmi = latest.bmi;
      d.weightLog = weights.map(w => ({ date: w.date, weight: w.weight }));
    }

    // SpO2
    if (raw.spo2) {
      // API returns different formats
      const val = raw.spo2.value || raw.spo2;
      if (typeof val === 'object' && val.avg) {
        d.spo2 = Math.round(val.avg);
        d.spo2Min = val.min;
        d.spo2Max = val.max;
      } else if (raw.spo2.dateTime && raw.spo2.value) {
        d.spo2 = Math.round(raw.spo2.value.avg || raw.spo2.value);
      }
    }

    // Breathing rate
    if (raw.brRate?.br?.[0]?.value) {
      d.breathingRate = raw.brRate.br[0].value.breathingRate;
    }

    // Skin temperature
    if (raw.tempSkin?.tempSkin?.[0]?.value) {
      d.skinTempChange = raw.tempSkin.tempSkin[0].value.nightlyRelative;
    }

    // Cardio fitness score (VO2 Max estimate)
    if (raw.cardioScore?.cardioScore?.[0]?.value) {
      d.vo2Max = raw.cardioScore.cardioScore[0].value.vo2Max;
    }

    return d;
  }

  // ── Public API ──
  return {
    getConfig,
    saveConfig,
    getToken,
    getUserId,
    isAuthenticated,
    startAuth,
    handleCallback,
    logout,
    fetchAllData,
    extractDashboardData,
    getCachedData,
    today,
  };
})();
