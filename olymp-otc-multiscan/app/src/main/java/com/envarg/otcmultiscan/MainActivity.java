package com.envarg.otcmultiscan;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.HttpsURLConnection;

public final class MainActivity extends Activity {
    private static final String NOTIFICATION_CHANNEL = "envarg_otc_multi_signals";
    private static final int PERMISSION_REQUEST = 145;
    // Each ticker is from an Olymptrade OTC asset page/catalogue. Availability of
    // candles at the observed endpoint is checked independently at runtime.
    private static final Set<String> SUPPORTED = new HashSet<>(Arrays.asList(
        "EURUSD_OTC", "GBPUSD_OTC", "USDJPY_OTC", "USDCHF_OTC", "USDCAD_OTC",
        "AUDUSD_OTC", "NZDUSD_OTC", "EURJPY_OTC", "EURGBP_OTC", "EURCHF_OTC",
        "EURCAD_OTC", "EURAUD_OTC", "EURNZD_OTC", "GBPJPY_OTC", "GBPCHF_OTC",
        "GBPCAD_OTC", "GBPAUD_OTC", "GBPNZD_OTC", "AUDJPY_OTC", "AUDCAD_OTC",
        "AUDCHF_OTC", "AUDNZD_OTC", "CADJPY_OTC", "CADCHF_OTC", "CHFJPY_OTC",
        "BTCUSD_OTC", "ETHUSD_OTC", "DOGUSD_OTC", "PEPEUSD_OTC", "LTCUSD_OTC",
        "XRPUSD_OTC", "SOLUSD_OTC"
    ));
    private final ExecutorService workerPool = Executors.newFixedThreadPool(4);
    private final ExecutorService scanCoordinator = Executors.newSingleThreadExecutor();
    private final AtomicBoolean scanning = new AtomicBoolean(false);
    private volatile boolean destroyed = false;
    private WebView webView;
    private int notificationId = 9000;

    public final class Bridge {
        @JavascriptInterface
        public void scanAssets(String csv) {
            if (csv == null) return;
            LinkedHashSet<String> assets = new LinkedHashSet<>();
            for (String raw : csv.split(",")) {
                String symbol = raw.trim().toUpperCase(Locale.ROOT);
                if (SUPPORTED.contains(symbol)) assets.add(symbol);
            }
            if (assets.isEmpty() || assets.size() > 36 || !scanning.compareAndSet(false, true)) return;
            List<String> list = new ArrayList<>(assets);
            scanCoordinator.execute(() -> {
                CountDownLatch latch = new CountDownLatch(list.size());
                for (String asset : list) {
                    workerPool.execute(() -> {
                        try {
                            final String rawJson = fetchCandles(asset);
                            postJs("window.nativeAssetResult(" + JSONObject.quote(asset) + "," +
                                   JSONObject.quote(rawJson) + ")");
                        } catch (Exception ex) {
                            String msg = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
                            if (msg.length() > 160) msg = msg.substring(0, 160);
                            postJs("window.nativeAssetError(" + JSONObject.quote(asset) + "," +
                                   JSONObject.quote(msg) + ")");
                        } finally {
                            latch.countDown();
                        }
                    });
                }
                try {
                    latch.await(230, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                } finally {
                    scanning.set(false);
                    postJs("window.nativeScanDone()");
                }
            });
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST);
                }
            });
        }

        @JavascriptInterface
        public void notifySignal(String symbol, String side, String score, String entryWindow, String expiryTime) {
            if (!SUPPORTED.contains(symbol) || (!"UP".equals(side) && !"DOWN".equals(side))) return;
            runOnUiThread(() -> publishSignal(symbol, side, score, entryWindow, expiryTime));
        }

        @JavascriptInterface
        public void notifyPaperResult(String symbol, String result, String paperPnl, String exitTime) {
            if (!SUPPORTED.contains(symbol) || (!"WIN".equals(result) && !"LOSS".equals(result))) return;
            runOnUiThread(() -> publishPaperResult(symbol, result, paperPnl, exitTime));
        }
    }

    private String fetchCandles(String asset) throws IOException {
        HttpsURLConnection connection = null;
        try {
            URL url = new URL("https://gw-plus.olymptrade.com/api/assets/v1/" + asset +
                    "?scan=" + System.currentTimeMillis());
            connection = (HttpsURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(12000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cache-Control", "no-cache");
            int http = connection.getResponseCode();
            if (http < 200 || http >= 300) throw new IOException("HTTP " + http + " (source unavailable)");
            InputStream in = connection.getInputStream();
            if (in == null) throw new IOException("Empty response");
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                char[] buffer = new char[4096];
                int n;
                while ((n = reader.read(buffer)) >= 0) {
                    if (n == 0) continue;
                    body.append(buffer, 0, n);
                    if (body.length() > 1500000) throw new IOException("Response exceeds size limit");
                }
                if (body.length() == 0) throw new IOException("Empty data body");
                return body.toString();
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void postJs(String script) {
        if (destroyed) return;
        runOnUiThread(() -> {
            if (!destroyed && webView != null) {
                webView.evaluateJavascript(script + ";", null);
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initNotifications();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8, 16, 31));
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        webView.addJavascriptInterface(new Bridge(), "MultiBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void initNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    NOTIFICATION_CHANNEL, "OTC Multi Scanner signals", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Strong OTC signals while the scanner is open");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 230, 100, 230});
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
    }

    private String labelForSymbol(String symbol) {
        String label = symbol.endsWith("_OTC") ? symbol.substring(0, symbol.length() - 4) : symbol;
        if (label.length() == 6) label = label.substring(0, 3) + "/" + label.substring(3);
        return label + " OTC";
    }

    private void publishSignal(String symbol, String side, String score, String entryWindow, String expiryTime) {
        String title = labelForSymbol(symbol) + " • STRONG " + side;
        String body = "Score " + score + "/100 (not accuracy). Entry " + entryWindow +
                      ". Expiry " + expiryTime + " (paper quote only)";
        pushNotification(title, body);
    }

    private void publishPaperResult(String symbol, String result, String paperPnl, String exitTime) {
        String title = labelForSymbol(symbol) + " • VIRTUAL " + result;
        String body = "Paper P/L " + paperPnl + " • source quote " + exitTime +
                      " • not a real Olymptrade trade";
        pushNotification(title, body);
    }

    private void pushNotification(String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, NOTIFICATION_CHANNEL);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH);
        }
        b.setSmallIcon(android.R.drawable.ic_dialog_info)
         .setContentTitle(title).setContentText(body)
         .setStyle(new Notification.BigTextStyle().bigText(body))
         .setAutoCancel(true);
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(notificationId++, b.build());
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        workerPool.shutdownNow();
        scanCoordinator.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("MultiBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
