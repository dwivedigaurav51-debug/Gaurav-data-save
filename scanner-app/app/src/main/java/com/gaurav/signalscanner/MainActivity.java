package com.gaurav.signalscanner;
import android.app.*;import android.os.*;import android.webkit.*;import android.graphics.Color;import android.content.pm.PackageManager;
public class MainActivity extends Activity{
 WebView w;
 @Override public void onCreate(Bundle b){super.onCreate(b);
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},7);
  w=new WebView(this);w.setBackgroundColor(Color.rgb(7,17,31));WebSettings s=w.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setCacheMode(WebSettings.LOAD_DEFAULT);
  w.addJavascriptInterface(new Object(){@JavascriptInterface public void superSignal(String pair,String side,String duration,String validTill){runOnUiThread(()->notifyStrong(pair,side,duration,validTill));}},"AndroidNotify");
  w.setWebViewClient(new WebViewClient());w.clearCache(true);w.loadUrl("https://gaurav-signal.hatchable.site");setContentView(w);
 }
 void notifyStrong(String pair,String side,String duration,String validTill){
  String id="strong";NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
  if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel(id,"Super Strong Signals",NotificationManager.IMPORTANCE_HIGH));
  Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,id):new Notification.Builder(this);
  b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("🔥 SUPER STRONG: "+pair+" "+side).setContentText(duration+" • Valid till "+validTill).setAutoCancel(true).setDefaults(Notification.DEFAULT_ALL);
  nm.notify(9001,b.build());
 }
 @Override public void onBackPressed(){if(w.canGoBack())w.goBack();else super.onBackPressed();}
}