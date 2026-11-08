package com.example.smsreader.sync;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import com.example.smsreader.SetupCheck;

import org.json.JSONObject;

/**
 * Reports this phone's sync state to Supabase (settings key "sync_health:<phone>")
 * so the web app can warn when a phone stops syncing.
 */
final class Heartbeat {

    private static final String TAG = "Heartbeat";
    private static final long WEEK_MS = 7L * 24 * 60 * 60 * 1000;

    private Heartbeat() {}

    static void send(Context c, String phone, OutboxDao dao, String lastError) {
        try {
            long now = System.currentTimeMillis();
            JSONObject v = new JSONObject();
            v.put("phone", phone);
            v.put("last_sync", now);
            long lastUpload = SyncPrefs.sp(c).getLong("last_upload", 0);
            if (lastUpload > 0) v.put("last_upload", lastUpload);
            v.put("pending", dao.pendingCount());
            v.put("listener", SetupCheck.notificationAccessOn(c));
            v.put("battery_unrestricted", SetupCheck.batteryUnrestricted(c));
            v.put("app_version", appVersion(c));
            v.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            v.put("ingest_since", SyncPrefs.cutoff(c));
            JSONObject captured = new JSONObject();
            for (OutboxDao.SourceCount sc : dao.capturedSince(now - WEEK_MS)) {
                captured.put(sc.source, sc.n);
            }
            v.put("captured_7d", captured);
            // Notification listener activity (counts only, since this version was installed)
            JSONObject notif = new JSONObject();
            notif.put("sms_app", SyncPrefs.sp(c).getInt("notif_sms_app", 0));
            notif.put("bank", SyncPrefs.sp(c).getInt("notif_bank", 0));
            long lastBank = SyncPrefs.sp(c).getLong("notif_bank_last", 0);
            if (lastBank > 0) notif.put("bank_last", lastBank);
            v.put("notifications_seen", notif);
            if (lastError != null) v.put("last_error", lastError);
            SupabaseApi.saveSetting("sync_health:" + phone, v);
        } catch (Exception e) {
            Log.w(TAG, "Heartbeat failed", e);
        }
    }

    private static String appVersion(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
            return p.versionName + " (" + code + ")";
        } catch (Exception e) {
            return "?";
        }
    }
}
