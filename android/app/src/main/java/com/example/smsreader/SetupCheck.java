package com.example.smsreader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.example.smsreader.sync.SyncPrefs;

/**
 * Checks the phone settings that background syncing depends on, and walks the user
 * through fixing them one at a time (each button opens the exact settings screen).
 */
public final class SetupCheck {

    private static final long SNOOZE_MS = 12L * 60 * 60 * 1000;
    private static final String KEY_SNOOZE = "setup_snooze_until";
    private static final String KEY_VIVO_OPENED = "vivo_power_opened";
    private static final String KEY_VIVO_DONE = "vivo_power_confirmed";

    private SetupCheck() {}

    /** The app may read notifications (catches bank messages that are not plain SMS). */
    public static boolean notificationAccessOn(Context c) {
        return NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.getPackageName());
    }

    /** Android's battery optimisation is off for this app. */
    public static boolean batteryUnrestricted(Context c) {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }

    private static boolean isVivo() {
        return "vivo".equalsIgnoreCase(Build.MANUFACTURER);
    }

    /**
     * Shows the setup checklist if something is still off. Returns the dialog shown
     * (or the one already showing) so the caller doesn't stack dialogs.
     */
    public static AlertDialog maybePrompt(Activity a, AlertDialog current) {
        if (current != null && current.isShowing()) return current;
        SharedPreferences p = SyncPrefs.sp(a);
        boolean notif = notificationAccessOn(a);
        boolean battery = batteryUnrestricted(a);
        boolean vivoDone = !isVivo() || p.getBoolean(KEY_VIVO_DONE, false);
        if (notif && battery && vivoDone) return null;
        if (System.currentTimeMillis() < p.getLong(KEY_SNOOZE, 0)) return null;

        // Back from vivo's power screen: we can't read that setting, so ask.
        if (notif && battery && p.getBoolean(KEY_VIVO_OPENED, false)) {
            return new AlertDialog.Builder(a)
                .setTitle("Background power")
                .setMessage("Did you allow ExpTrack high background power consumption?")
                .setPositiveButton("Yes, done", (d, w) -> p.edit().putBoolean(KEY_VIVO_DONE, true).apply())
                .setNeutralButton("Open again", (d, w) -> openVivoPower(a))
                .setNegativeButton("Later", (d, w) -> snooze(p))
                .setCancelable(false)
                .show();
        }

        StringBuilder msg = new StringBuilder("So bank messages reach ExpTrack even when the app is closed:\n\n");
        msg.append(notif ? "✅" : "⬜").append("  Notification access\n");
        msg.append(battery ? "✅" : "⬜").append("  No battery restriction\n");
        if (isVivo()) msg.append(vivoDone ? "✅" : "⬜").append("  vivo: high background power\n");

        String action = !notif ? "Allow notification access"
            : !battery ? "Remove battery restriction"
            : "Open vivo power settings";
        return new AlertDialog.Builder(a)
            .setTitle("Finish setup")
            .setMessage(msg.toString())
            .setPositiveButton(action, (d, w) -> {
                if (!notif) openNotificationAccess(a);
                else if (!battery) requestBatteryExemption(a);
                else openVivoPower(a);
            })
            .setNegativeButton("Later", (d, w) -> snooze(p))
            .setCancelable(false)
            .show();
    }

    private static void snooze(SharedPreferences p) {
        p.edit().putLong(KEY_SNOOZE, System.currentTimeMillis() + SNOOZE_MS).apply();
    }

    private static void openNotificationAccess(Activity a) {
        if (Build.VERSION.SDK_INT >= 30) {
            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            i.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                new ComponentName(a, BankNotificationListener.class).flattenToString());
            if (tryStart(a, i)) return;
        }
        tryStart(a, new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
    }

    private static void requestBatteryExemption(Activity a) {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + a.getPackageName()));
        if (!tryStart(a, i)) tryStart(a, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    /** vivo's "High background power consumption" list, else this app's settings page. */
    private static void openVivoPower(Activity a) {
        SyncPrefs.sp(a).edit().putBoolean(KEY_VIVO_OPENED, true).apply();
        if (tryStart(a, new Intent("com.vivo.abe.highpower.search.powermanageractivity"))) return;
        Intent explicit = new Intent().setComponent(new ComponentName("com.vivo.abe",
            "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity"));
        if (tryStart(a, explicit)) return;
        tryStart(a, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + a.getPackageName())));
    }

    private static boolean tryStart(Activity a, Intent i) {
        try {
            a.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
