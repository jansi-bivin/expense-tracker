package com.example.smsreader;

import android.app.Notification;
import android.app.Person;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import com.example.smsreader.sync.BankSenders;
import com.example.smsreader.sync.Ingest;
import com.example.smsreader.sync.SyncPrefs;
import com.example.smsreader.sync.SyncScheduler;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Reads the notifications the phone's SMS app shows.
 *
 * Two jobs:
 *  1. Catch bank messages that never become real SMS (vivo Messages receives some
 *     through vivo's own push service; no SMS reader can see those).
 *  2. Keep the app alive: Android keeps notification listeners connected, so the
 *     live SMS receiver and background jobs keep working on phones that kill apps.
 *
 * Only notifications from SMS apps, from a bank sender and mentioning an amount are
 * used. Everything else is ignored immediately and never stored or sent.
 */
public class BankNotificationListener extends NotificationListenerService {

    private static final String TAG = "BankNotifListener";
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Set<String> SMS_APPS = new HashSet<>(Arrays.asList(
        "com.android.mms",                      // vivo, Xiaomi, OPPO, realme
        "com.google.android.apps.messaging",    // Google Messages
        "com.samsung.android.messaging",        // Samsung
        "com.android.messaging",                // AOSP
        "com.oneplus.mms"
    ));

    private static final class Msg {
        final String sender;
        final String text;
        final long time;
        Msg(String sender, String text, long time) {
            this.sender = sender;
            this.text = text;
            this.time = time;
        }
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        Log.d(TAG, "Notification listener connected");
        try {
            SyncScheduler.ensurePeriodic(this);
            SyncScheduler.checkNow(this);
        } catch (Exception e) {
            Log.w(TAG, "Could not schedule sync", e);
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (!isSmsApp(sbn.getPackageName())) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            List<Msg> msgs = extract(n, sbn.getPostTime());
            Context app = getApplicationContext();
            countSeen(app, !msgs.isEmpty());
            if (msgs.isEmpty()) return;
            EXEC.execute(() -> {
                for (Msg m : msgs) {
                    try {
                        Ingest.add(app, "notif", m.sender, m.text, m.time);
                    } catch (Exception e) {
                        Log.w(TAG, "Could not queue message", e);
                    }
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "Could not read notification", e);
        }
    }

    /** Counts only (no content) so the sync report shows the listener is working. */
    private static void countSeen(Context c, boolean bank) {
        android.content.SharedPreferences p = SyncPrefs.sp(c);
        android.content.SharedPreferences.Editor e = p.edit()
            .putInt("notif_sms_app", p.getInt("notif_sms_app", 0) + 1);
        if (bank) {
            e.putInt("notif_bank", p.getInt("notif_bank", 0) + 1)
             .putLong("notif_bank_last", System.currentTimeMillis());
        }
        e.apply();
    }

    private boolean isSmsApp(String pkg) {
        if (pkg == null) return false;
        if (SMS_APPS.contains(pkg)) return true;
        String def = Telephony.Sms.getDefaultSmsPackage(this);
        return pkg.equals(def);
    }

    private static List<Msg> extract(Notification n, long postTime) {
        List<Msg> out = new ArrayList<>();
        Bundle x = n.extras;
        if (x == null) return out;
        String title = str(x.getCharSequence(Notification.EXTRA_TITLE));
        String conversation = str(x.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        long when = n.when > 0 ? n.when : postTime;

        // Chat-style notification: one entry per message.
        Parcelable[] messages = x.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (messages != null && messages.length > 0) {
            for (Parcelable p : messages) {
                if (!(p instanceof Bundle)) continue;
                Bundle b = (Bundle) p;
                String text = str(b.getCharSequence("text"));
                long time = b.getLong("time", when);
                String sender = str(b.getCharSequence("sender"));
                if (sender == null && Build.VERSION.SDK_INT >= 28) {
                    Object person = b.get("sender_person");
                    if (person instanceof Person) sender = str(((Person) person).getName());
                }
                String from = firstBank(conversation, title, sender);
                if (from != null && BankSenders.mentionsMoney(text)) out.add(new Msg(from, text, time));
            }
            return out;
        }

        // Plain notification: full text is in big text when expanded.
        String big = str(x.getCharSequence(Notification.EXTRA_BIG_TEXT));
        String text = big != null ? big : str(x.getCharSequence(Notification.EXTRA_TEXT));
        String from = firstBank(conversation, title, null);
        if (from != null && BankSenders.mentionsMoney(text)) {
            out.add(new Msg(from, text, when));
            return out;
        }

        // Inbox-style summary: one line per message, often "Sender: text".
        CharSequence[] lines = x.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null) {
            for (CharSequence l : lines) {
                String line = str(l);
                if (line == null) continue;
                int colon = line.indexOf(": ");
                String lineSender = colon > 0 ? line.substring(0, colon) : null;
                String lineText = colon > 0 ? line.substring(colon + 2) : line;
                String f = firstBank(lineSender, from, null);
                if (f != null && BankSenders.mentionsMoney(lineText)) out.add(new Msg(f, lineText, when));
            }
        }
        return out;
    }

    private static String firstBank(String a, String b, String c) {
        for (String s : new String[]{a, b, c}) {
            if (s != null && BankSenders.isBankTitle(s)) return s;
        }
        return null;
    }

    private static String str(CharSequence cs) {
        if (cs == null) return null;
        String s = cs.toString().trim();
        return s.isEmpty() ? null : s;
    }
}
