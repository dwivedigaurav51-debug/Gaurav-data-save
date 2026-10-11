package com.envarg.otcmultiscan;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.content.SharedPreferences;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import java.util.ArrayDeque;

public final class OlympSearchService extends AccessibilityService {
    public static final String PREF = "olymp_search_assist";
    public static final String KEY = "pending_symbol";
    public static final String TIME = "pending_time";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String active = "";
    private int stage = 0;
    private long lastAction = 0;
    private boolean busy = false;

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null ||
            !"com.ticno.olymptrade".contentEquals(event.getPackageName())) return;
        SharedPreferences prefs = getSharedPreferences(PREF, MODE_PRIVATE);
        String symbol = prefs.getString(KEY, "");
        long time = prefs.getLong(TIME, 0);
        if (TextUtils.isEmpty(symbol) || System.currentTimeMillis() - time > 45000) {
            if (!TextUtils.isEmpty(symbol)) prefs.edit().remove(KEY).remove(TIME).apply();
            return;
        }
        if (!symbol.equals(active)) { active = symbol; stage = 0; lastAction = 0; busy = false; }
        if (busy || System.currentTimeMillis() - lastAction < 850) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        try {
            if (stage == 0) {
                // Prefer the named asset selector; never touch trading controls.
                AccessibilityNodeInfo asset = findAssetLabel(root);
                if (asset != null && clickAncestor(asset)) { stage = 1; lastAction = System.currentTimeMillis(); return; }
                // Only fall back to a top-of-screen selector tap when the Fixed Time terminal is visible.
                if (containsText(root, "Fixed Time") && !containsText(root, "Assets")) {
                    stage = 1; lastAction = System.currentTimeMillis(); tap(0.34f, 0.194f); return;
                }
                if (containsText(root, "Assets")) stage = 1;
            }
            if (stage == 1 && containsText(root, "Assets")) {
                AccessibilityNodeInfo search = findDescription(root, "Search");
                if (search != null && clickAncestor(search)) { stage = 2; lastAction = System.currentTimeMillis(); return; }
                // Screenshot places Search at the top right of the Assets page.
                stage = 2; lastAction = System.currentTimeMillis(); tap(0.925f, 0.081f); return;
            }
            if (stage == 2) {
                AccessibilityNodeInfo input = findEditable(root);
                if (input != null) {
                    Bundle args = new Bundle();
                    args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, symbol);
                    if (input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                        prefs.edit().remove(KEY).remove(TIME).apply();
                        active = ""; stage = 0;
                    }
                }
            }
        } finally { root.recycle(); }
    }

    private AccessibilityNodeInfo findAssetLabel(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> q = new ArrayDeque<>(); q.add(root);
        while (!q.isEmpty()) {
            AccessibilityNodeInfo n = q.remove();
            CharSequence t = n.getText();
            if (t != null) {
                String s = t.toString();
                if (s.contains("Composi") || s.contains("OTC") || s.contains("Index") || s.contains("Quickler")) {
                    // Only on terminal, not on Assets list.
                    if (!containsText(root, "Assets") && containsText(root, "Fixed Time")) return n;
                }
            }
            for (int i=0;i<n.getChildCount();i++) { AccessibilityNodeInfo c=n.getChild(i); if(c!=null)q.add(c); }
        }
        return null;
    }
    private boolean containsText(AccessibilityNodeInfo root, String value) {
        ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>(); q.add(root);
        while(!q.isEmpty()) {
            AccessibilityNodeInfo n=q.remove();
            if(n.getText()!=null && n.getText().toString().contains(value))return true;
            for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo c=n.getChild(i);if(c!=null)q.add(c);}
        }
        return false;
    }
    private AccessibilityNodeInfo findDescription(AccessibilityNodeInfo root,String value) {
        ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>();q.add(root);
        while(!q.isEmpty()){
            AccessibilityNodeInfo n=q.remove();
            CharSequence d=n.getContentDescription();
            if(d!=null && d.toString().toLowerCase().contains(value.toLowerCase()))return n;
            for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo c=n.getChild(i);if(c!=null)q.add(c);}
        }
        return null;
    }
    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo root) {
        ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>();q.add(root);
        while(!q.isEmpty()){
            AccessibilityNodeInfo n=q.remove();
            if(n.isEditable())return n;
            for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo c=n.getChild(i);if(c!=null)q.add(c);}
        }
        return null;
    }
    private boolean clickAncestor(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo n=node;
        for(int i=0;i<5 && n!=null;i++,n=n.getParent())
            if(n.isClickable() && n.performAction(AccessibilityNodeInfo.ACTION_CLICK))return true;
        return false;
    }
    private void tap(float xf,float yf) {
        DisplayMetrics m=getResources().getDisplayMetrics();
        Path path=new Path();path.moveTo(m.widthPixels*xf,m.heightPixels*yf);
        GestureDescription.Builder b=new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(path,0,80));
        busy=true;
        dispatchGesture(b.build(),new GestureResultCallback(){
            @Override public void onCompleted(GestureDescription g){busy=false;}
            @Override public void onCancelled(GestureDescription g){busy=false;}
        },handler);
    }
    @Override public void onInterrupt(){busy=false;}
}
