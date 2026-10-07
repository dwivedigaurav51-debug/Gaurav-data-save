package com.gaurav.signalscannertest;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;

public class MainActivity extends Activity {
    private static final String HOME = "https://gaurav-signal.hatchable.site";
    private WebView w;
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        w = new WebView(this);
        w.setBackgroundColor(Color.rgb(7,17,31));
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        w.setWebViewClient(new WebViewClient() {
            private boolean allowed(Uri u) {
                return u != null && "https".equalsIgnoreCase(u.getScheme()) && "gaurav-signal.hatchable.site".equalsIgnoreCase(u.getHost());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { return !allowed(req.getUrl()); }
        });
        w.loadUrl(HOME);
        setContentView(w);
    }
    @Override public void onBackPressed() { if (w != null && w.canGoBack()) w.goBack(); else super.onBackPressed(); }
}