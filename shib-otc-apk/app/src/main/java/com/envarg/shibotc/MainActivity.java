package com.envarg.shibotc;

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

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;

import javax.net.ssl.HttpsURLConnection;

public class MainActivity extends Activity {
    private static final String CHANNEL_ID = "shib_otc_alerts";
    private static final int REQ_NOTIFICATIONS = 101;
    private WebView webView;
    private int notificationId = 1000;

    public class AndroidBridge {
        @JavascriptInterface
        public String fetchShib() { return fetchOtc("SHIBUSD_OTC"); }

        @JavascriptInterface
        public String fetchOtc(String asset) {
            if (!"SHIBUSD_OTC".equals(asset) && !"PEPEUSD_OTC".equals(asset)) return "{\"_bridgeError\":\"Unsupported asset\"}";
            HttpsURLConnection conn = null;
            try {
                URL url = new URL("https://gw-plus.olymptrade.com/api/assets/v1/" + asset + "?x=" + System.currentTimeMillis());
                conn = (HttpsURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setUseCaches(false);
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("Cache-Control", "no-cache");
                int code = conn.getResponseCode();
                InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
                BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "UTF-8"));
                StringBuilder out = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) out.append(line);
                reader.close();
                if (code < 200 || code >= 300) {
                    return "{\"_bridgeError\":\"HTTP " + code + "\"}";
                }
                return out.toString();
            } catch (Exception e) {
                String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                msg = msg.replace("\\", "\\\\").replace("\"", "\\\"");
                return "{\"_bridgeError\":\"" + msg + "\"}";
            } finally {
                if (conn != null) conn.disconnect();
            }
        }

        @JavascriptInterface
        public void requestAlertsPermission() {
            runOnUiThread(() -> requestAlertsPermissionInternal());
        }

        @JavascriptInterface
        public void notifyEvent(String title, String body) {
            runOnUiThread(() -> showAlert(title, body));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannel();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8,16,31));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "SHIB OTC Alerts",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Virtual trade and WIN/LOSS alerts");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 250, 120, 250});
            nm.createNotificationChannel(channel);
        }
    }

    private void requestAlertsPermissionInternal() {
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
    }

    private void showAlert(String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestAlertsPermissionInternal();
            return;
        }

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
            builder.setPriority(Notification.PRIORITY_HIGH);
            builder.setVibrate(new long[]{0, 250, 120, 250});
        }

        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(notificationId++, builder.build());
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
