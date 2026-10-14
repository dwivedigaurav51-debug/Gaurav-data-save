package com.envarg.otcmultiscan;

import android.app.*;
import android.content.*;
import android.os.*;
import java.net.*;
import java.io.*;
import java.util.concurrent.*;

/** User-controlled background feed health monitor. No real-money trades or inferred signals. */
public final class BackgroundScanService extends Service {
 public static final String START="com.envarg.otcmultiscan.START_MONITOR", STOP="com.envarg.otcmultiscan.STOP_MONITOR";
 private static final String CHANNEL="envarg_monitor", PREF="monitor_state";
 private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor();
 private volatile boolean running=false;
 private ScheduledFuture<?> job;
 @Override public void onCreate(){super.onCreate();
  NotificationChannel c=new NotificationChannel(CHANNEL,"OTC Background Monitor",NotificationManager.IMPORTANCE_LOW);
  ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
 }
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent!=null&&STOP.equals(intent.getAction())){stopMonitor();return START_NOT_STICKY;}
  if(!running){
   running=true;
   Notification n=notification("Checking OTC feed every 5 minutes");
   startForeground(441,n);
   getSharedPreferences(PREF,MODE_PRIVATE).edit().putBoolean("running",true).apply();
   job=executor.scheduleWithFixedDelay(this::checkFeed,0,300,TimeUnit.SECONDS);
  }
  return START_NOT_STICKY;
 }
 private Notification notification(String message){
  Intent stop=new Intent(this,BackgroundScanService.class).setAction(STOP);
  PendingIntent stopPi=PendingIntent.getService(this,2,stop,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Intent open=new Intent(this,MainActivity.class);
  PendingIntent openPi=PendingIntent.getActivity(this,3,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
   .setContentTitle("Envarg OTC · Background Monitor").setContentText(message)
   .setContentIntent(openPi).addAction(android.R.drawable.ic_menu_close_clear_cancel,"Stop",stopPi)
   .setOngoing(true).build();
 }
 private void checkFeed(){
  HttpURLConnection c=null;
  String status="Feed unavailable";
  try{
   URL url=new URL("https://gw-plus.olymptrade.com/api/assets/v1/EURUSD_OTC?scan="+System.currentTimeMillis());
   c=(HttpURLConnection)url.openConnection();c.setConnectTimeout(10000);c.setReadTimeout(12000);
   c.setRequestProperty("Accept","application/json");
   int code=c.getResponseCode();
   if(code==200){try(InputStream in=c.getInputStream()){if(in.read()!=-1)status="Feed reachable · "+new java.text.SimpleDateFormat("HH:mm",java.util.Locale.US).format(new java.util.Date());}}
   else status="Feed HTTP "+code;
  }catch(Exception e){status="Feed check failed";}finally{if(c!=null)c.disconnect();}
  getSharedPreferences(PREF,MODE_PRIVATE).edit().putLong("last_check",System.currentTimeMillis()).putString("feed_status",status).apply();
  if(running)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(441,notification(status));
 }
 private void stopMonitor(){running=false;if(job!=null)job.cancel(true);
  getSharedPreferences(PREF,MODE_PRIVATE).edit().putBoolean("running",false).apply();
  stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
 }
 @Override public void onTimeout(int startId,int fgsType){stopMonitor();}
 @Override public void onDestroy(){running=false;if(job!=null)job.cancel(true);executor.shutdownNow();
  getSharedPreferences(PREF,MODE_PRIVATE).edit().putBoolean("running",false).apply();super.onDestroy();}
 @Override public IBinder onBind(Intent intent){return null;}
}
