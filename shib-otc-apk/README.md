# SHIB OTC Virtual Signal APK — Official Feed V4

Standalone Android paper-trading app for SHIB OTC.

V4 fixes:
- Fixed one-trade-only cooldown bug by using official candle timestamps instead of array indexes
- Can take a new virtual trade on each eligible new official 5-minute candle
- Shows VIRTUAL TRADE TAKEN immediately with UP/BUY or DOWN/SELL, stake and entry
- Shows a live MM:SS expiry countdown
- History records OPEN immediately and updates the same row to WIN/LOSS at official expiry
- Default cooldown is 1 candle
- Uses Olymptrade public SHIBUSD_OTC data only; no simulated fallback
- Adaptive learning still waits for 20 similar completed trades before changing signal score
- No real-money orders
