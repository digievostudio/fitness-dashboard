/**
 * Fitbit Web API Integration
 * Authorization Code with PKCE — fully client-side, no backend needed
 * Register at https://dev.fitbit.com/apps — type: "Personal"
 */

class FitbitAPI {
  constructor() {
    this.AUTH_URL = 'https://www.fitbit.com/oauth2/authorize';
    this.TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
    this.API_BASE = 'https://api.fitbit.com';
    this.SCOPES = 'activity heartrate location nutrition profile settings sleep weight oxygen_saturation respiratory_rate temperature cardio_fitness';
    this.redirectUri = window.location.origin + window.location.pathname;
    this.accessToken = localStorage.getItem('fitbit_token');
    this.refreshToken = localStorage.getItem('fitbit_refresh_token');
    this.tokenExpiry = localStorage.getItem('fitbit_expiry');
    this.clientId = localStorage.getItem('fitbit_client_id') || '';
    this._configLoaded = this._tryLoadConfig();
  }

  async _tryLoadConfig() {
    try {
      const r = await fetch('config.json');
      if (r.ok) {
        const c = await r.json();
        if (!this.clientId && (c.fitbit?.client_id || c.client_id)) {
          this.clientId = c.fitbit?.client_id || c.client_id;
        }
      }
    } catch (e) {}
  }

  setClientId(id) {
    this.clientId = id;
    localStorage.setItem('fitbit_client_id', id);
  }

  // ── PKCE Helpers ──
  _generateCodeVerifier() {
    const arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async _generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ── OAuth Flow (PKCE) ──
  async startOAuth() {
    if (!this.clientId) throw new Error('No client_id');
    const verifier = this._generateCodeVerifier();
    const challenge = await this._generateCodeChallenge(verifier);
    sessionStorage.setItem('fitbit_pkce_verifier', verifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    window.location.href = `${this.AUTH_URL}?${params}`;
  }

  async handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return false;

    const verifier = sessionStorage.getItem('fitbit_pkce_verifier');
    if (!verifier) { console.error('PKCE verifier missing'); return false; }
    sessionStorage.removeItem('fitbit_pkce_verifier');

    try {
      const res = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: this.redirectUri,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('Token exchange failed:', err);
        return false;
      }
      const data = await res.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token || null;
      this.tokenExpiry = String(Date.now() + (data.expires_in || 28800) * 1000);
      localStorage.setItem('fitbit_token', this.accessToken);
      if (this.refreshToken) localStorage.setItem('fitbit_refresh_token', this.refreshToken);
      localStorage.setItem('fitbit_expiry', this.tokenExpiry);
      history.replaceState(null, '', window.location.pathname);
      return true;
    } catch (e) {
      console.error('Token exchange error:', e);
      return false;
    }
  }

  async _refreshAccessToken() {
    if (!this.refreshToken || !this.clientId) return false;
    try {
      const res = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token || this.refreshToken;
      this.tokenExpiry = String(Date.now() + (data.expires_in || 28800) * 1000);
      localStorage.setItem('fitbit_token', this.accessToken);
      if (this.refreshToken) localStorage.setItem('fitbit_refresh_token', this.refreshToken);
      localStorage.setItem('fitbit_expiry', this.tokenExpiry);
      return true;
    } catch (e) { return false; }
  }

  isAuthenticated() {
    return !!(this.accessToken && this.tokenExpiry && Date.now() < parseInt(this.tokenExpiry));
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    localStorage.removeItem('fitbit_token');
    localStorage.removeItem('fitbit_refresh_token');
    localStorage.removeItem('fitbit_expiry');
    localStorage.removeItem('fitbit_cache');
  }

  async _fetch(path) {
    if (!this.accessToken) throw new Error('Not authenticated');
    
    // CORS-blocked endpoints that need to be routed through the worker
    const corsBlockedPatterns = ['/spo2/', '/hrv/', '/br/', '/temp/skin/', '/cardioscore/'];
    const needsProxy = corsBlockedPatterns.some(pattern => path.includes(pattern));
    
    let url;
    let headers;
    
    if (needsProxy) {
      // Route through Cloudflare Worker proxy
      url = `https://fitbit-cors-proxy.njandu.workers.dev${path}`;
      headers = { 
        'Authorization': `Bearer ${this.accessToken}`, 
        'Accept': 'application/json',
        'X-Fitbit-Path': path
      };
    } else {
      // Direct Fitbit API call
      url = `${this.API_BASE}${path}`;
      headers = { 
        'Authorization': `Bearer ${this.accessToken}`, 
        'Accept': 'application/json' 
      };
    }
    
    let res = await fetch(url, { headers });
    
    // Auto-refresh on 401
    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this._refreshAccessToken();
      if (refreshed) {
        if (needsProxy) {
          headers.Authorization = `Bearer ${this.accessToken}`;
        } else {
          headers.Authorization = `Bearer ${this.accessToken}`;
        }
        res = await fetch(url, { headers });
      } else {
        this.clearTokens(); throw new Error('Token expired');
      }
    }
    if (res.status === 401) { this.clearTokens(); throw new Error('Token expired'); }
    if (res.status === 429) throw new Error('Rate limited');
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  getTodayDate() { return new Date().toISOString().split('T')[0]; }
  getDateDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

  // ── API Methods ──
  async getProfile() { return this._fetch('/1/user/-/profile.json'); }
  async getActivitySummary() { return this._fetch(`/1/user/-/activities/date/${this.getTodayDate()}.json`); }
  async getSleep() { return this._fetch(`/1.2/user/-/sleep/date/${this.getTodayDate()}.json`); }
  async getSleepRange(start, end) { return this._fetch(`/1.2/user/-/sleep/date/${start}/${end}.json`); }
  async getHeartRateIntraday() { return this._fetch(`/1/user/-/activities/heart/date/${this.getTodayDate()}/1d/1min.json`); }
  async getStepsTimeSeries(start, end) { return this._fetch(`/1/user/-/activities/steps/date/${start}/${end}.json`); }
  async getStepsIntraday() { return this._fetch(`/1/user/-/activities/steps/date/${this.getTodayDate()}/1d/15min.json`); }
  async getWeightLog() { return this._fetch(`/1/user/-/body/log/weight/date/${this.getTodayDate()}/30d.json`); }
  async getHRV() { return this._fetch(`/1/user/-/hrv/date/${this.getTodayDate()}.json`); }
  async getSpO2() { return this._fetch(`/1/user/-/spo2/date/${this.getTodayDate()}.json`); }
  async getBreathingRate() { return this._fetch(`/1/user/-/br/date/${this.getTodayDate()}.json`); }
  async getSkinTemp() { return this._fetch(`/1/user/-/temp/skin/date/${this.getTodayDate()}.json`); }
  async getVO2Max() { return this._fetch(`/1/user/-/cardioscore/date/${this.getTodayDate()}.json`); }

  // ── Demo Data Generators ──
  generateDemoProfile() {
    return { user: { displayName: 'Demo User', avatar150: '', memberSince: '2020-01-01' } };
  }

  generateDemoActivitySummary() {
    return {
      summary: {
        steps: 8543, caloriesOut: 2345, floors: 12,
        distances: [{ activity: 'total', distance: 6.2 }],
        lightlyActiveMinutes: 180, fairlyActiveMinutes: 30, veryActiveMinutes: 15, sedentaryMinutes: 680,
        restingHeartRate: 62,
        heartRateZones: [
          { name: 'Out of Range', min: 30, max: 92, minutes: 1320 },
          { name: 'Fat Burn', min: 92, max: 129, minutes: 120 },
          { name: 'Cardio', min: 129, max: 157, minutes: 30 },
          { name: 'Peak', min: 157, max: 220, minutes: 10 }
        ]
      },
      goals: { steps: 10000, distance: 8, floors: 10, caloriesOut: 2500, activeMinutes: 30 }
    };
  }

  generateDemoSleep() {
    const levels = ['light','deep','light','rem','light','wake','light','deep','light','rem','light','wake','light'];
    const data = []; let t = new Date(); t.setHours(0, 34, 0, 0);
    levels.forEach(l => {
      const secs = (l === 'wake' ? 5 : 20 + Math.random() * 30) * 60;
      data.push({ dateTime: t.toISOString(), level: l, seconds: Math.round(secs) });
      t = new Date(t.getTime() + secs * 1000);
    });
    return {
      sleep: [{
        isMainSleep: true, dateOfSleep: this.getTodayDate(),
        minutesAsleep: 389, minutesAwake: 43, timeInBed: 432, efficiency: 81,
        startTime: new Date(new Date().setHours(0, 34)).toISOString(),
        endTime: new Date(new Date().setHours(7, 46)).toISOString(),
        duration: 389 * 60 * 1000, type: 'stages',
        levels: {
          data,
          shortData: [
            { dateTime: new Date(new Date().setHours(2, 15)).toISOString(), level: 'wake', seconds: 120 },
            { dateTime: new Date(new Date().setHours(4, 30)).toISOString(), level: 'wake', seconds: 90 },
          ],
          summary: {
            deep: { count: 3, minutes: 78, thirtyDayAvgMinutes: 85 },
            light: { count: 12, minutes: 202, thirtyDayAvgMinutes: 210 },
            rem: { count: 5, minutes: 66, thirtyDayAvgMinutes: 72 },
            wake: { count: 8, minutes: 43, thirtyDayAvgMinutes: 38 }
          }
        }
      }]
    };
  }

  generateDemoSleepRange(days) {
    const sleeps = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      sleeps.push({
        isMainSleep: true, dateOfSleep: d.toISOString().split('T')[0],
        minutesAsleep: 350 + Math.round(Math.random() * 100),
        efficiency: 75 + Math.round(Math.random() * 20),
        duration: (350 + Math.round(Math.random() * 100)) * 60 * 1000
      });
    }
    return { sleep: sleeps };
  }

  generateDemoHeartRateIntraday() {
    const dataset = [];
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 5) {
      let v = h < 6 || h >= 22 ? 55 + Math.random() * 10
        : h >= 7 && h <= 8 ? 110 + Math.random() * 30
        : 65 + Math.random() * 15;
      dataset.push({ time: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`, value: Math.round(v) });
    }
    return {
      'activities-heart': [{ dateTime: this.getTodayDate(), value: {
        restingHeartRate: 62,
        heartRateZones: [
          { name: 'Out of Range', min: 30, max: 92, minutes: 1320 },
          { name: 'Fat Burn', min: 92, max: 129, minutes: 120 },
          { name: 'Cardio', min: 129, max: 157, minutes: 30 },
          { name: 'Peak', min: 157, max: 220, minutes: 10 }
        ]
      }}],
      'activities-heart-intraday': { dataset }
    };
  }

  generateDemoHRV() {
    return { hrv: [{ dateTime: this.getTodayDate(), value: { dailyRmssd: 42.5, deepRmssd: 48.2 } }] };
  }

  generateDemoSpO2() {
    return { dateTime: this.getTodayDate(), value: { avg: 96.5, min: 94, max: 98 } };
  }

  generateDemoStepsTimeSeries(days) {
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      data.push({ dateTime: d.toISOString().split('T')[0], value: String(5000 + Math.round(Math.random() * 7000)) });
    }
    return { 'activities-steps': data };
  }

  generateDemoStepsIntraday() {
    const dataset = [];
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 15) {
      let v = h < 6 || h >= 22 ? Math.random() * 10
        : h >= 7 && h <= 8 ? 400 + Math.random() * 200
        : 50 + Math.random() * 150;
      dataset.push({ time: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`, value: Math.round(v) });
    }
    return { 'activities-steps-intraday': { dataset } };
  }

  generateDemoWeight() {
    const data = []; let w = 76;
    for (let i = 29; i >= 0; i--) {
      w += (Math.random() - 0.5) * 0.5;
      const d = new Date(); d.setDate(d.getDate() - i);
      data.push({ date: d.toISOString().split('T')[0], weight: parseFloat(w.toFixed(1)), bmi: parseFloat((w / 1.7 / 1.7).toFixed(1)) });
    }
    return { weight: data };
  }
}
