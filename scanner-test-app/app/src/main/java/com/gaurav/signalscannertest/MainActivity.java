package com.gaurav.signalscannertest;
import android.app.Activity;import android.os.Bundle;import android.graphics.Color;import android.webkit.*;
public class MainActivity extends Activity{
 WebView w;
 @Override public void onCreate(Bundle b){super.onCreate(b);w=new WebView(this);w.setBackgroundColor(Color.rgb(5,11,21));WebSettings s=w.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(true);s.setAllowFileAccessFromFileURLs(true);s.setAllowUniversalAccessFromFileURLs(true);s.setAllowContentAccess(true);w.setWebViewClient(new WebViewClient());w.loadUrl("file:///android_asset/index.html");setContentView(w);}
 @Override public void onBackPressed(){if(w!=null&&w.canGoBack())w.goBack();else super.onBackPressed();}
}