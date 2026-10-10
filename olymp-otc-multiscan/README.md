# Envarg OTC Multi Scanner — separate Android app

This is a completely independent, paper-signal-only Android application.

- **Package ID:** `com.envarg.otcmultiscan`
- **Launcher name:** Envarg OTC Multi Scanner
- **Version:** 1.0
- **Independent of older apps:** `com.envarg.shibotc`, `com.envarg.otcultimate`. Their APKs, application storage, balances and saved trade histories are not touched.
- **32 watchlist entries:** 25 OTC forex pairs + 7 crypto OTC names.
- **Asset-specific Strong UP/DOWN** candidates, 5m candle history, source status, score (indicator agreement, **not** win probability), ticker name, price, local candle time and de-duplicated local alert history.
- **Native parallel scan:** 4 worker threads, source checked about every 5 minutes **while app is open**, with two-minute manual refresh cooldown.
- **Independent feed checks:** wrong symbol, invalid/stale price or timestamp, insufficient history and missing 5m candles are rejected. Each instrument can show FEED ERROR or WARMUP; a website listing does **not** imply a usable live feed.
- **Notification:** Android notification while running for a newly found qualifying fresh candle. Notifications and scanner do not run in background when app is fully closed.
- **Not official:** Uses an observed `gw-plus.olymptrade.com` asset endpoint with no guarantee of ongoing public access or terminal-price equivalence. No login or real-money order execution.

## Build and download

GitHub Actions: [Build Envarg OTC Multi Scanner](https://github.com/dwivedigaurav51-debug/Gaurav-data-save/actions/workflows/build-envarg-otc-multiscanner.yml).

Open the newest **green successful** workflow run and download **Artifacts → Envarg-OTC-Multi-Scanner-V1**, extract the ZIP and install `Envarg-OTC-Multi-Scanner-V1.apk`. Do not use an older SHIB OTC artifact.

The workflow runs Node.js quote-validation tests and Gradle assembleDebug, and checks the APK contents. If the build is red, inspect its job logs instead of treating a previous APK as the new build. This README does not attest to a successful build.

## Signals

The price-series algorithm requires 60 correctly spaced 5-minute candles. It checks EMA 9/21/50 trend agreement, MACD, RSI, close-range position, Bollinger Bands, a momentum gap and absolute close volatility. All prices come from the selected asset endpoint; **never** substitute standard market crypto or forex prices for broker OTC candles. Indicator scores are heuristic, not calibrated success probabilities.

At least one symbol can show no signal for extended periods. All 32 feeds are individually tested at runtime; there is **no** claim that every source will work on every phone or that the signals are 100% accurate.
