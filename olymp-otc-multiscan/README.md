# Envarg OTC Multi Scanner — separate Android app

This is a completely independent, paper-signal-only Android application.

- **Package ID:** `com.envarg.otcmultiscan`
- **Launcher name:** Envarg OTC Multi Scanner
- **Version:** 3.0
- **Independent of older apps:** `com.envarg.shibotc`, `com.envarg.otcultimate`. Their APKs, application storage, balances and saved trade histories are not touched.
- **32 watchlist entries:** 25 OTC forex pairs + 7 crypto OTC names.
- **Asset-specific Strong UP/DOWN** candidates, 5m candle history, source status, score (indicator agreement, **not** win probability), ticker name, price, local candle time and de-duplicated local alert history.
- **Native parallel scan:** 4 worker threads, source checked about every 5 minutes **while app is open**, with two-minute manual refresh cooldown.
- **Independent feed checks:** wrong symbol, invalid/stale price or timestamp, insufficient history and missing 5m candles are rejected. Each instrument can show FEED ERROR or WARMUP; a website listing does **not** imply a usable live feed.
- **Notification:** Android notification while running for a newly found qualifying fresh candle. Notifications and scanner do not run in background when app is fully closed.
- **Not official:** Uses an observed `gw-plus.olymptrade.com` asset endpoint with no guarantee of ongoing public access or terminal-price equivalence. No login or real-money order execution.

## Build and download

GitHub Actions: [Build Envarg OTC Multi Scanner](https://github.com/dwivedigaurav51-debug/Gaurav-data-save/actions/workflows/build-envarg-otc-multiscanner.yml).

Open the newest **green successful** workflow run and download **Artifacts → Envarg-OTC-Multi-Scanner-V3**, extract the ZIP and install `Envarg-OTC-Multi-Scanner-V1.apk`. Do not use an older SHIB OTC artifact.

The workflow runs Node.js quote-validation tests and Gradle assembleDebug, and checks the APK contents. If the build is red, inspect its job logs instead of treating a previous APK as the new build. This README does not attest to a successful build.

## V3 fixes: 100/100 indicator-score-only entries and alerts

- **Only an exactly 100/100 technical-indicator score qualifies**. Scores of 99 or less are not shown as new qualifying signals, do not start paper trades, and do not send notifications. A score of 100 is *not* a 100% win probability.
- The previous two-minute source-timestamp rule often rejected perfectly good closed-candle detections without creating a virtual trade. Now such 100-score signals become visible **WAITING ENTRY**, held for the next newer 5-minute source candle (up to 15 minutes); no backdated trade is invented.
- When a next newer source candle is observed and is no more than seven minutes old, the app records a new simulated 5-minute entry at observation time, shows BUY FROM / BUY UNTIL, paper entry quote, and expiry. **The observed source close is a retrospective reference, not an executable Olymptrade trading quote.**
- A 100/100 entry with a sufficiently fresh source quote can open immediately. Each qualifying signal trades only once; ₹200 stake, separate V3 ₹10,000 virtual wallet, WIN/LOSS/DRAW/VOID history, per-currency win rates.
- **Only 100-score paper ENTRY triggers a phone notification.** Paper WIN/LOSS still updates the app's history but does not generate result notifications. No notifications for queued-only, invalid, older, or sub-100 signals.
- A pending entry that never receives a newer usable candle times out and is recorded as a skipped signal. Data cannot be fabricated, so some 100-score detections will still correctly have no paper entry.
- V3 uses fresh local storage keys for its **100-score-only** wallet and signal log. Existing V2 local storage is not deleted or modified, but older 85–99 score activity is not merged into V3 statistics. Other independently packaged SHIB/Ultimate apps are unaffected.
- Android APK success and live quote equivalence must be verified on a device; this README does not certify Olymptrade feed compatibility.

## Auto virtual trading added in V2 (historical notes)

- Every **new** Strong Signal is checked for an actionable, fresh source candle. If the latest candle timestamp is more than two minutes old, the paper entry is skipped and shown as **ENTRY CLOSED** instead of pretending a backdated trade.
- If the source is fresh and **Auto Virtual Trades** is enabled (default ON), a ₹200 paper trade is opened immediately using the latest validated 5m source close as a **reference**, never a live executable broker quote.
- Separate starting paper wallet: **₹10,000**. Illustrated WIN payout 90%: ₹200 WIN yields ₹180 net paper profit; LOSS is -₹200; ties become DRAW, stake refunded.
- Each accepted entry records the asset name, UP/BUY or DOWN/SELL, score, entry reference price, **entry start**, **buy until** (at most 60 seconds, shortened by source age), and **expiry target** (5 minutes after simulated entry), in the phone's local time.
- A trade is **OPEN** until a future validated source point with timestamp at or just after the target expiry is found. Actual settlement may be later than the target by up to one 5m source interval because intraminute quotes are unavailable.
- If the required expiry source point is missing and the series has passed its allowable window, the trade becomes **VOID** and the paper stake is refunded. VOID and DRAW do **not** count as WIN/LOSS.
- The app calculates **WIN / (WIN + LOSS)**, cumulative balance, P/L, per-currency WIN/LOSS, active trades, countdowns, and persistent virtual trade history. Notifications include the symbol and entry window/expiry; WIN/LOSS results notify only when enabled.
- Trading logic and records are stored **only inside the Multi Scanner app**. Existing SHIB OTC and Ultimate V11 apps remain separate.
- Source candle price may differ from Olymptrade terminal pricing; virtual outcomes are **illustrative**, not verified real broker trade results. The app scans only while open; when re-opened it settles any pending trades only if historical expiry source prices can be verified.

## Signals

The price-series algorithm requires 60 correctly spaced 5-minute candles. It checks EMA 9/21/50 trend agreement, MACD, RSI, close-range position, Bollinger Bands, a momentum gap and absolute close volatility. All prices come from the selected asset endpoint; **never** substitute standard market crypto or forex prices for broker OTC candles. Indicator scores are heuristic, not calibrated success probabilities.

At least one symbol can show no signal for extended periods. All 32 feeds are individually tested at runtime; there is **no** claim that every source will work on every phone or that the signals are 100% accurate.
