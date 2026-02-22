// fitbit-api.js - Comprehensive Fitbit API Client
// Handles OAuth, token management, and all available Fitbit API endpoints

class FitbitAPI {
  constructor() {
    this.clientId = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.cache = {};
    this.CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
  }

  // Initialize - try to load config.json, then localStorage
  async init() {
    // Try loading client_id from config.json
    try {
      const response = await fetch('config.json');
      if (response.ok) {
        const config = await response.json();
        if (config.client_id) {
          this.clientId = config.client_id;
        }
      }
    } catch (e) {
      // config.json doesn't exist or isn't valid JSON, that's okay
    }

    // Load from localStorage (overrides config.json if set)
    const storedClientId = localStorage.getItem('fitbit_client_id');
    if (storedClientId) {
      this.clientId = storedClientId;
    }

    this.accessToken = localStorage.getItem('fitbit_access_token');
    this.refreshToken = localStorage.getItem('fitbit_refresh_token');
    this.tokenExpiry = localStorage.getItem('fitbit_token_expiry');

    return this.isAuthenticated();
  }

  // Auto-detect redirect URI from current URL
  getRedirectUri() {
    const url = new URL(window.location.href);
    return `${url.origin}${url.pathname}`;
  }

  // Set client ID (from setup screen)
  setClientId(clientId) {
    this.clientId = clientId;
    localStorage.setItem('fitbit_client_id', clientId);
  }

  // OAuth flow - generate authorization URL
  getAuthUrl() {
    if (!this.clientId) {
      throw new Error('Client ID not set');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'token',
      scope: 'activity heartrate location nutrition profile settings sleep social weight',
      redirect_uri: this.getRedirectUri(),
      expires_in: '31536000' // 1 year
    });

    return `https://www.fitbit.com/oauth2/authorize?${params.toString()}`;
  }

  // Handle OAuth callback (token in URL fragment)
  handleCallback() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    const accessToken = params.get('access_token');
    const expiresIn = params.get('expires_in');

    if (accessToken) {
      this.accessToken = accessToken;
      this.tokenExpiry = Date.now() + (parseInt(expiresIn) * 1000);
      
      localStorage.setItem('fitbit_access_token', accessToken);
      localStorage.setItem('fitbit_token_expiry', this.tokenExpiry.toString());
      
      // Clear hash from URL
      window.history.replaceState(null, null, window.location.pathname);
      return true;
    }
    return false;
  }

  // Check if authenticated
  isAuthenticated() {
    if (!this.accessToken || !this.tokenExpiry) {
      return false;
    }
    // Check if token expired
    if (Date.now() >= this.tokenExpiry) {
      this.logout();
      return false;
    }
    return true;
  }

  // Logout
  logout() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.cache = {};
    localStorage.removeItem('fitbit_access_token');
    localStorage.removeItem('fitbit_refresh_token');
    localStorage.removeItem('fitbit_token_expiry');
  }

  // Generic API call with caching
  async apiCall(endpoint, useCache = true) {
    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    // Check cache
    if (useCache && this.cache[endpoint]) {
      const cached = this.cache[endpoint];
      if (Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.data;
      }
    }

    const response = await fetch(`https://api.fitbit.com${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.logout();
        throw new Error('Authentication expired');
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Cache the result
    if (useCache) {
      this.cache[endpoint] = {
        timestamp: Date.now(),
        data: data
      };
    }

    return data;
  }

  // Helper to get today's date in YYYY-MM-DD format
  getTodayString() {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  // Helper to get date N days ago
  getDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  // === PROFILE ===
  async getProfile() {
    return this.apiCall('/1/user/-/profile.json');
  }

  // === BADGES ===
  async getBadges() {
    return this.apiCall('/1/user/-/badges.json');
  }

  // === ACTIVITY ===
  async getActivitySummary(date = 'today') {
    return this.apiCall(`/1/user/-/activities/date/${date}.json`);
  }

  async getLifetimeStats() {
    return this.apiCall('/1/user/-/activities.json');
  }

  async getActivityLog(afterDate, limit = 10) {
    const params = new URLSearchParams({
      afterDate: afterDate,
      sort: 'desc',
      limit: limit.toString(),
      offset: '0'
    });
    return this.apiCall(`/1/user/-/activities/list.json?${params.toString()}`);
  }

  async getSteps30Day() {
    const today = this.getTodayString();
    return this.apiCall(`/1/user/-/activities/steps/date/${today}/30d.json`);
  }

  async getSteps7Day() {
    const today = this.getTodayString();
    return this.apiCall(`/1/user/-/activities/steps/date/${today}/7d.json`);
  }

  async getIntradaySteps(date = 'today') {
    return this.apiCall(`/1/user/-/activities/steps/date/${date}/1d/15min.json`);
  }

  // === HEART RATE ===
  async getHeartRate(date = 'today') {
    return this.apiCall(`/1/user/-/activities/heart/date/${date}/1d.json`);
  }

  async getIntradayHeartRate(date = 'today') {
    return this.apiCall(`/1/user/-/activities/heart/date/${date}/1d/1min.json`);
  }

  // === SLEEP ===
  async getSleep(date = 'today') {
    return this.apiCall(`/1.2/user/-/sleep/date/${date}.json`);
  }

  async getSleep7Day(date) {
    return this.apiCall(`/1.2/user/-/sleep/date/${date}/7d.json`);
  }

  // === BODY ===
  async getWeight(date = 'today') {
    return this.apiCall(`/1/user/-/body/log/weight/date/${date}/30d.json`);
  }

  // === BREATHING RATE ===
  async getBreathingRate(date = 'today') {
    return this.apiCall(`/1/user/-/br/date/${date}.json`);
  }

  // === SPO2 ===
  async getSpO2(date = 'today') {
    return this.apiCall(`/1/user/-/spo2/date/${date}.json`);
  }

  // === TEMPERATURE ===
  async getTemperature(date = 'today') {
    return this.apiCall(`/1/user/-/temp/skin/date/${date}.json`);
  }

  // === VO2 MAX ===
  async getVO2Max(date = 'today') {
    return this.apiCall(`/1/user/-/cardioscore/date/${date}.json`);
  }

  // === COMPREHENSIVE DATA FETCH ===
  async getAllData() {
    const today = this.getTodayString();
    const weekAgo = this.getDaysAgo(7);
    const monthAgo = this.getDaysAgo(30);

    const results = await Promise.allSettled([
      this.getProfile(),
      this.getBadges(),
      this.getActivitySummary(),
      this.getLifetimeStats(),
      this.getActivityLog(monthAgo, 10),
      this.getSteps30Day(),
      this.getSteps7Day(),
      this.getIntradaySteps(),
      this.getHeartRate(),
      this.getIntradayHeartRate(),
      this.getSleep(),
      this.getSleep7Day(today),
      this.getWeight(),
      this.getBreathingRate(),
      this.getSpO2(),
      this.getTemperature(),
      this.getVO2Max()
    ]);

    // Convert results to named object
    const [
      profile,
      badges,
      activity,
      lifetime,
      activityLog,
      steps30d,
      steps7d,
      intradaySteps,
      heartRate,
      intradayHeartRate,
      sleep,
      sleep7d,
      weight,
      breathingRate,
      spo2,
      temperature,
      vo2max
    ] = results;

    return {
      profile: profile.status === 'fulfilled' ? profile.value : null,
      badges: badges.status === 'fulfilled' ? badges.value : null,
      activity: activity.status === 'fulfilled' ? activity.value : null,
      lifetime: lifetime.status === 'fulfilled' ? lifetime.value : null,
      activityLog: activityLog.status === 'fulfilled' ? activityLog.value : null,
      steps30d: steps30d.status === 'fulfilled' ? steps30d.value : null,
      steps7d: steps7d.status === 'fulfilled' ? steps7d.value : null,
      intradaySteps: intradaySteps.status === 'fulfilled' ? intradaySteps.value : null,
      heartRate: heartRate.status === 'fulfilled' ? heartRate.value : null,
      intradayHeartRate: intradayHeartRate.status === 'fulfilled' ? intradayHeartRate.value : null,
      sleep: sleep.status === 'fulfilled' ? sleep.value : null,
      sleep7d: sleep7d.status === 'fulfilled' ? sleep7d.value : null,
      weight: weight.status === 'fulfilled' ? weight.value : null,
      breathingRate: breathingRate.status === 'fulfilled' ? breathingRate.value : null,
      spo2: spo2.status === 'fulfilled' ? spo2.value : null,
      temperature: temperature.status === 'fulfilled' ? temperature.value : null,
      vo2max: vo2max.status === 'fulfilled' ? vo2max.value : null
    };
  }

  // Clear cache (for refresh button)
  clearCache() {
    this.cache = {};
  }
}

// Export for use in HTML
if (typeof window !== 'undefined') {
  window.FitbitAPI = FitbitAPI;
}
