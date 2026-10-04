# SHIB OTC Virtual Signal APK — Official Feed V3

Standalone Android paper-trading app for SHIB OTC.

V3 changes:
- Removed simulated SHIB price generation
- Reads Olymptrade public SHIBUSD_OTC asset data directly over HTTPS
- Uses the freshest official public chart series (currently 5-minute close points)
- Blocks signals when the feed is stale or unavailable
- Virtual trade entry and WIN/LOSS settlement use official-source timestamps/prices
- Adaptive learning starts fresh and requires 20 similar completed trades before changing score
- Keeps EMA, RSI, MACD, Bollinger, close-stochastic, close-volatility, auto virtual trades and 90% virtual payout
- No real-money orders
