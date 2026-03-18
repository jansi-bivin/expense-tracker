package com.example.smsreader;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import android.os.Build;

import androidx.core.app.NotificationCompat;
import me.leolin.shortcutbadger.ShortcutBadger;

public class NotificationHelper {

    private static final String CHANNEL_ID = "sms_transaction_channel";
    private static final String CHANNEL_NAME = "New Expense";
    private static final int NOTIFICATION_ID = 1001; // Fixed ID — always updates same notification
    private static final String PREFS_NAME = "notification_prefs";
    private static final String KEY_PENDING_COUNT = "pending_count";

    public static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("New bank transaction notifications");
            channel.enableVibration(true);
            channel.setShowBadge(true);

            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public static void showTransactionNotification(Context context, String title, String message) {
        createChannel(context);

        // Increment pending count
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int count = prefs.getInt(KEY_PENDING_COUNT, 0) + 1;
        prefs.edit().putInt(KEY_PENDING_COUNT, count).apply();

        // Tap notification → open web app inside WebViewActivity
        Intent webViewIntent = new Intent(context, WebViewActivity.class);
        webViewIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, webViewIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String contentTitle = count == 1 ? title : count + " expenses to categorize";
        String contentText = count == 1 ? message : "Latest: " + title + " — Tap to open";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(contentTitle)
                .setContentText(contentText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(contentText))
                .setNumber(count)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent)
                .setOngoing(true)   // Persistent — can't swipe away
                .setAutoCancel(false);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, builder.build());
        }

        // Launcher icon badge (works on Vivo, Samsung, Xiaomi, Huawei, etc.)
        ShortcutBadger.applyCount(context, count);
    }

    /**
     * Call this when the user opens the web app to clear the notification.
     * Can also be called from PermissionActivity.
     */
    public static void clearNotification(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt(KEY_PENDING_COUNT, 0).apply();

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
        }

        // Clear launcher icon badge
        ShortcutBadger.removeCount(context);
    }
}
