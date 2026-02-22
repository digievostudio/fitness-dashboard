/**
 * Fitbit Web API Integration
 * Uses Implicit Grant Flow (client-side only, no backend needed)
 * 
 * Setup: Enter your client_id via the setup screen or config.json
 * Register app at https://dev.fitbit.com/apps — type: "Personal"
 * Set redirect URI to your GitHub Pages URL
 */

const FitbitAPI = (() => {
  const AUTH_URL = 'https://www.fitbit.com/oauth2/authorize';
  const API_BASE = 'https://api.fitbit.com';
  const STORAGE_TOKEN = 'fitbit_access_token';
  const STORAGE_USER = 'fitbit_user_id';
  const STORAGE_EXPIRES = 'fitbit_token_expires';
  const STORAGE_CLIENT = 'fitbit_client_id';
  const STORAGE_CACHE = 'fitbit_data_cache';

  const SCOPES = 'activity heartrate sleep weight profile oxygen_saturation respiratory_rate temperature cardio_fitness';

  let _configClientId = null; // from config.json

  // ── Config ──
  async function loadConfigJson() {
    try {
      const res = await fetch('config.json');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.fitbit?.client_id) _configClientId = cfg.fitbit.client_id;
        else if (cfg.client_id) _configClientId = cfg.client_id;
      }
    } catch (e) { /* no config.json, that's fine */ }
  }

  function getClientId() {
    return localStorage.getItem(STORAGE_CLIENT) || _configClientId || '';
  }

  function saveClientId(id) {
    localStorage.setItem(STORAGE_CLIENT, id);
  }

  // ── Auth ──
  function getToken() {
    const token = localStorage.getItem(STORAGE_TOKEN);
    const expires = localStorage.getItem(STORAGE_EXPIRES);
    if (token && expires && Date.now() < parseInt(expires)) return token;
    if (token) { localStorage.removeItem(STORAGE_TOKEN); localStorage.removeItem(STORAGE_USER); localStorage.removeItem(STORAGE_EXPIRES); }
    return null;
  }

  function isAuthenticated() { return !!getToken(); }

  function startAuth(clientId) {
    if (clientId) saveClientId(clientId);
    const cid = getClientId();
    if (!cid) throw new Error('No client_id configured');
    const redirectUri = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      response_type: 'token',
      client_id: cid,
      redirect_uri: redirectUri,
      scope: SCOPES,
      expires_in: '2592000', // 30 days
    });
    window.location.href = `${AUTH_URL}?${params.toString()}`;
  }

  function handleCallback() {
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
  async function apiFetch(path) {
    const token = getToken();
    if (!token) throw new Error('Not authenticated');
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    if (res.status === 401) { logout(); throw new Error('Token expired'); }
    if (!res.ok) { const t = await res.text(); throw new Error(`API ${res.status}: ${t}`); }
    return res.json();
  }

  // ── Cache ──
  function getCachedData() {
    try {
      const c = JSON.parse(localStorage.getItem(STORAGE_CACHE) || 'null');
      if (c && c._ts && Date.now() - c._ts < 15 * 60 * 1000) return c;
    } catch (e) {}
    return null;
  }
  function setCachedData(d) { d._ts = Date.now(); try { localStorage.setItem(STORAGE_CACHE, JSON.stringify(d)); } catch(e){} }
  function clearCache() { localStorage.removeItem(STORAGE_CACHE); }

  // ── Helpers ──
  function today() { return new Date().toISOString().split('T')[0]; }
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

  // ── Fetch All Data ──
  async function fetchAllData(skipCache) {
    if (!skipCache) { const c = getCachedData(); if (c) return c; }
    const d = today();
    const uid = localStorage.getItem(STORAGE_USER) || '-';

    const [
      profile, activitySummary, activityGoals,
      steps7d, steps30d, intradaySteps,
      heartDay, intradayHR,
      sleepDay, sleep7d,
      weight, spo2, brRate, tempSkin, cardioScore,
      lifetime, activityLog, badges
    ] = await Promise.allSettled([
      apiFetch(`/1/user/${uid}/profile.json`),
      apiFetch(`/1/user/${uid}/activities/date/${d}.json`),
      apiFetch(`/1/user/${uid}/activities/goals/daily.json`),
      apiFetch(`/1/user/${uid}/activities/steps/date/${d}/7d.json`),
      apiFetch(`/1/user/${uid}/activities/steps/date/${d}/30d.json`),
      apiFetch(`/1/user/${uid}/activities/steps/date/${d}/1d/15min.json`),
      apiFetch(`/1/user/${uid}/activities/heart/date/${d}/1d.json`),
      apiFetch(`/1/user/${uid}/activities/heart/date/${d}/1d/1min.json`),
      apiFetch(`/1.2/user/${uid}/sleep/date/${d}.json`),
      apiFetch(`/1.2/user/${uid}/sleep/date/${daysAgo(6)}/${d}.json`),
      apiFetch(`/1/user/${uid}/body/log/weight/date/${d}/30d.json`),
      apiFetch(`/1/user/${uid}/spo2/date/${d}.json`),
      apiFetch(`/1/user/${uid}/br/date/${d}.json`),
      apiFetch(`/1/user/${uid}/temp/skin/date/${d}.json`),
      apiFetch(`/1/user/${uid}/cardioscore/date/${d}.json`),
      apiFetch(`/1/user/${uid}/activities.json`),
      apiFetch(`/1/user/${uid}/activities/list.json?afterDate=${daysAgo(30)}&sort=desc&limit=10&offset=0`),
      apiFetch(`/1/user/${uid}/badges.json`),
    ]);

    const v = r => r.status === 'fulfilled' ? r.value : null;
    const data = {
      profile: v(profile), activity: v(activitySummary), goals: v(activityGoals),
      steps7d: v(steps7d), steps30d: v(steps30d), intradaySteps: v(intradaySteps),
      heartDay: v(heartDay), intradayHR: v(intradayHR),
      sleep: v(sleepDay), sleep7d: v(sleep7d),
      weight: v(weight), spo2: v(spo2), brRate: v(brRate),
      tempSkin: v(tempSkin), cardioScore: v(cardioScore),
      lifetime: v(lifetime), activityLog: v(activityLog), badges: v(badges),
    };
    setCachedData(data);
    return data;
  }

  // ── Extract normalized dashboard data from raw API responses ──
  function extract(raw) {
    const d = {};

    // Profile
    if (raw.profile?.user) {
      const u = raw.profile.user;
      d.displayName = u.displayName;
      d.avatar = u.avatar150 || u.avatar;
      d.memberSince = u.memberSince;
    }

    // Activity summary
    if (raw.activity?.summary) {
      const s = raw.activity.summary;
      d.steps = s.steps;
      d.calories = s.caloriesOut;
      d.activeMinutes = (s.fairlyActiveMinutes || 0) + (s.veryActiveMinutes || 0);
      d.sedentaryMinutes = s.sedentaryMinutes;
      d.lightlyActiveMinutes = s.lightlyActiveMinutes;
      d.fairlyActiveMinutes = s.fairlyActiveMinutes;
      d.veryActiveMinutes = s.veryActiveMinutes;
      d.floors = s.floors;
      d.elevation = s.elevation;

      // distance - find total
      if (s.distances) {
        const tot = s.distances.find(x => x.activity === 'total');
        if (tot) d.distance = tot.distance;
      }

      // Heart rate zones from activity summary
      if (s.heartRateZones) d.heartRateZones = s.heartRateZones;
      if (s.restingHeartRate) d.restingHeartRate = s.restingHeartRate;
    }

    // Goals
    if (raw.goals?.goals) {
      const g = raw.goals.goals;
      d.stepsGoal = g.steps;
      d.distanceGoal = g.distance;
      d.floorsGoal = g.floors;
      d.caloriesGoal = g.caloriesOut;
      d.activeMinutesGoal = g.activeMinutes;
    }

    // Steps 7-day
    if (raw.steps7d?.['activities-steps']) {
      d.stepsWeek = raw.steps7d['activities-steps'].map(x => ({ date: x.dateTime, value: parseInt(x.value) || 0 }));
    }

    // Steps 30-day
    if (raw.steps30d?.['activities-steps']) {
      d.stepsMonth = raw.steps30d['activities-steps'].map(x => ({ date: x.dateTime, value: parseInt(x.value) || 0 }));
    }

    // Intraday steps (15-min)
    if (raw.intradaySteps?.['activities-steps-intraday']?.dataset) {
      d.intradaySteps = raw.intradaySteps['activities-steps-intraday'].dataset;
    }

    // Heart rate from heart day endpoint
    if (raw.heartDay?.['activities-heart']?.[0]?.value) {
      const hv = raw.heartDay['activities-heart'][0].value;
      if (!d.restingHeartRate && hv.restingHeartRate) d.restingHeartRate = hv.restingHeartRate;
      if (!d.heartRateZones && hv.heartRateZones) d.heartRateZones = hv.heartRateZones;
    }

    // Intraday HR (1-min)
    if (raw.intradayHR?.['activities-heart-intraday']?.dataset) {
      d.intradayHR = raw.intradayHR['activities-heart-intraday'].dataset;
    }

    // Sleep - find main sleep
    if (raw.sleep?.sleep && raw.sleep.sleep.length > 0) {
      const mainSleep = raw.sleep.sleep.find(s => s.isMainSleep) || raw.sleep.sleep[0];
      d.sleepDuration = mainSleep.minutesAsleep;
      d.sleepTimeInBed = mainSleep.timeInBed;
      d.sleepEfficiency = mainSleep.efficiency;
      d.sleepStartTime = mainSleep.startTime;
      d.sleepEndTime = mainSleep.endTime;

      // Sleep stages
      if (mainSleep.levels) {
        if (mainSleep.levels.summary) {
          d.sleepStages = {
            deep: mainSleep.levels.summary.deep?.minutes,
            light: mainSleep.levels.summary.light?.minutes,
            rem: mainSleep.levels.summary.rem?.minutes,
            wake: mainSleep.levels.summary.wake?.minutes,
          };
        }
        // Detailed timeline data
        if (mainSleep.levels.data) {
          d.sleepTimeline = mainSleep.levels.data;
        }
      }
    }

    // Sleep 7-day
    if (raw.sleep7d?.sleep && raw.sleep7d.sleep.length > 0) {
      d.sleepWeek = raw.sleep7d.sleep
        .filter(s => s.isMainSleep)
        .map(s => ({
          date: s.dateOfSleep,
          minutesAsleep: s.minutesAsleep,
          efficiency: s.efficiency,
          duration: s.duration,
        }));
    }

    // Weight
    if (raw.weight?.weight && raw.weight.weight.length > 0) {
      d.weightLog = raw.weight.weight.map(w => ({ date: w.date, weight: w.weight, bmi: w.bmi }));
      const latest = raw.weight.weight[raw.weight.weight.length - 1];
      d.weight = latest.weight;
      d.bmi = latest.bmi;
    }

    // SpO2
    if (raw.spo2) {
      const val = raw.spo2.value || raw.spo2;
      if (val && typeof val === 'object' && val.avg != null) {
        d.spo2 = val.avg;
        d.spo2Min = val.min;
        d.spo2Max = val.max;
      }
    }

    // Breathing rate
    if (raw.brRate?.br?.[0]?.value?.breathingRate != null) {
      d.breathingRate = raw.brRate.br[0].value.breathingRate;
    }

    // Skin temp
    if (raw.tempSkin?.tempSkin?.[0]?.value?.nightlyRelative != null) {
      d.skinTempChange = raw.tempSkin.tempSkin[0].value.nightlyRelative;
    }

    // VO2 Max
    if (raw.cardioScore?.cardioScore?.[0]?.value?.vo2Max != null) {
      d.vo2Max = raw.cardioScore.cardioScore[0].value.vo2Max;
    }

    // Lifetime stats
    if (raw.lifetime?.lifetime?.total) {
      d.lifetime = raw.lifetime.lifetime.total;
    }

    // Recent activities
    if (raw.activityLog?.activities && raw.activityLog.activities.length > 0) {
      d.recentActivities = raw.activityLog.activities.map(a => ({
        name: a.activityName,
        date: a.startDate || a.originalStartTime,
        startTime: a.startTime || a.originalStartTime,
        duration: a.activeDuration || a.duration,
        calories: a.calories,
        steps: a.steps,
        distance: a.distance,
        averageHeartRate: a.averageHeartRate,
      }));
    }

    // Badges
    if (raw.badges?.badges && raw.badges.badges.length > 0) {
      d.badges = raw.badges.badges.map(b => ({
        name: b.shortName || b.badgeName,
        description: b.description || b.marketingDescription,
        image: b.image100px || b.image75px || b.image50px,
        timesAchieved: b.timesAchieved,
        dateTime: b.dateTime,
      }));
    }

    return d;
  }

  return {
    loadConfigJson, getClientId, saveClientId,
    isAuthenticated, startAuth, handleCallback, logout,
    fetchAllData, extract, clearCache, getToken, today,
  };
})();
