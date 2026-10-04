# SHIB OTC Virtual Signal APK — Adaptive V2

Standalone Android paper-trading simulator for SHIB OTC.

Adaptive V2:
- Stores indicator/pattern context for every virtual signal
- Learns from completed WIN/LOSS results
- Reinforces historically stronger setups
- Reduces confidence for weak recurring setups
- Requires minimum sample sizes before changing score
- Caps adaptive score changes to reduce overfitting
- Shows Base Score vs Adaptive Score
- Tracks recent learning win rate and learned pattern stats
- No Martingale and no real-money orders
