# Health Dashboard

A beautiful, responsive health dashboard that connects to your Fitbit account and displays your real health data in three distinct presentation styles.

**[Live Demo →](https://digievolabs.github.io/fitness-dashboard/)**

## Three Styles

| Style | Theme | Vibe |
|-------|-------|------|
| **Fitbit Classic** | Dark, cards, progress rings | Familiar Fitbit app feel |
| **Editorial** | Cream, serif, newspaper grid | Bloomberg meets Monocle magazine |
| **Neon Pulse** | Cyberpunk HUD, monospace, glowing | Blade Runner health terminal |

Switch between styles via the top tab bar. Same data, three completely different experiences.

## Setup

### 1. Register a Fitbit App

1. Go to [dev.fitbit.com/apps](https://dev.fitbit.com/apps)
2. Click **Register a New Application**
3. Fill in:
   - **Application Name:** Health Dashboard (or anything)
   - **Description:** Personal health dashboard
   - **Application Website:** `https://digievolabs.github.io/fitness-dashboard/`
   - **Organization:** Your name
   - **Organization Website:** Same as above
   - **Terms of Service URL:** Same as above
   - **Privacy Policy URL:** Same as above
   - **OAuth 2.0 Application Type:** **Personal**
   - **Redirect URL:** `https://digievolabs.github.io/fitness-dashboard/`
   - **Default Access Type:** **Read-Only**
4. Save and copy your **OAuth 2.0 Client ID**

### 2. Connect Your Account

1. Open the dashboard: [digievolabs.github.io/fitness-dashboard](https://digievolabs.github.io/fitness-dashboard/)
2. Enter your **Client ID** in the setup screen
3. Click **Connect Fitbit Account**
4. Authorize the app on Fitbit's consent screen
5. You'll be redirected back with your live data

### 3. Or Use Demo Data

Click "View with Demo Data" to preview the dashboard without connecting a Fitbit account.

## Data Fetched

The dashboard makes 12 parallel API calls:

- **Profile** — display name, avatar
- **Activity Summary** — steps, distance, floors, calories, active minutes
- **Steps (7-day)** — weekly trend chart
- **Heart Rate** — current, resting, zones
- **Heart Rate (7-day)** — resting HR trend
- **Sleep** — duration, score, stages (deep/light/REM/awake)
- **Weight (30-day)** — latest weight, BMI, trend
- **SpO₂** — blood oxygen saturation
- **Breathing Rate** — breaths per minute
- **Skin Temperature** — nightly variation
- **Cardio Fitness** — VO₂ Max estimate
- **Activity Goals** — personalized daily goals

## Technical Details

- **Auth:** OAuth 2.0 Implicit Grant Flow (client-side only)
- **Token:** Stored in `localStorage`, 30-day expiry
- **Cache:** 15-minute client-side cache to respect rate limits
- **Backend:** None — 100% static, runs on GitHub Pages
- **Dependencies:** Zero — single HTML file + one JS module
- **Responsive:** Mobile (430px) → Tablet (600px) → Desktop (960px) → Wide (1280px)
- **Fonts:** DM Sans, Outfit, Playfair Display, Source Serif 4, JetBrains Mono

## Config

You can also pre-configure the Client ID in `config.json`:

```json
{
  "fitbit": {
    "client_id": "YOUR_CLIENT_ID_HERE",
    "redirect_uri": "https://digievolabs.github.io/fitness-dashboard/"
  }
}
```

## Self-Host

```bash
git clone https://github.com/DigievoLabs/fitness-dashboard.git
cd fitness-dashboard
python3 -m http.server 8765
# Open http://localhost:8765
```

Update the redirect URI in your Fitbit app settings to match your local/hosted URL.

## License

MIT
