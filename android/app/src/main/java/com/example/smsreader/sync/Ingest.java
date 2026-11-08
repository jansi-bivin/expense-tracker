package com.example.smsreader.sync;

import android.content.Context;
import android.util.Log;

import com.example.smsreader.NotificationHelper;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Single entry point for every captured bank message, whichever path caught it.
 * Saves it on the phone first (so nothing is lost if the app is killed or offline),
 * drops repeats, then schedules the upload.
 */
public final class Ingest {

    private static final String TAG = "Ingest";
    private static final Object LOCK = new Object();

    /** Two copies of the same text within this window are the same message. */
    public static final long WINDOW_MS = 48L * 60 * 60 * 1000;
    /** Allow a little clock skew around the cutoff (bank timestamps can lag). */
    private static final long CUTOFF_GRACE_MS = 10L * 60 * 1000;

    private static final Pattern AMOUNT = Pattern.compile(
        "(?:Rs\\.?|INR|₹)\\s*([0-9,]+\\.?\\d{0,2})", Pattern.CASE_INSENSITIVE);

    private Ingest() {}

    /**
     * Queue a bank message for upload. Returns true if it is new.
     * Must be called off the main thread.
     *
     * @param source "sms", "notif" or "scan"
     */
    public static boolean add(Context context, String source, String address, String body, long date) {
        if (body == null || body.trim().isEmpty()) return false;
        Context app = context.getApplicationContext();
        long now = System.currentTimeMillis();
        long when = ((date > 0 ? date : now) / 1000) * 1000;
        if (when < SyncPrefs.cutoff(app) - CUTOFF_GRACE_MS) return false; // from before this version

        String norm = BankSenders.normalize(body);
        boolean isSmsCopy = !"notif".equals(source);
        OutboxDao dao = OutboxDatabase.get(app).dao();

        synchronized (LOCK) {
            for (OutboxEntity e : dao.inWindow(when - WINDOW_MS, when + WINDOW_MS)) {
                if (!BankSenders.sameMessage(e.norm, norm)) continue;
                // Seen already. If only a notification copy is waiting, swap in the real
                // SMS text and sender, which are complete and match the bank's format.
                if (OutboxEntity.PENDING.equals(e.status) && isSmsCopy && "notif".equals(e.source)) {
                    e.body = body;
                    e.norm = norm;
                    e.address = address;
                    e.source = source;
                    dao.update(e);
                }
                return false;
            }
            OutboxEntity e = new OutboxEntity();
            e.source = source;
            e.address = address;
            e.body = body;
            e.norm = norm;
            e.smsDate = when;
            e.status = OutboxEntity.PENDING;
            e.createdAt = now;
            dao.insert(e);
        }

        Log.d(TAG, "Queued " + source + " message from " + address);
        SyncScheduler.enqueueUpload(app);
        NotificationHelper.showTransactionNotification(app, describe(body), "Tap to categorize");
        return true;
    }

    /** "Debited Rs.12,444.00" — title for the app's own notification. */
    private static String describe(String body) {
        Matcher m = AMOUNT.matcher(body);
        String amount = m.find() ? m.group(1) : "?";
        String lower = body.toLowerCase(Locale.ROOT);
        String type = lower.contains("debit") ? "Debited" : lower.contains("credit") ? "Credited" : "Transaction";
        return type + " Rs." + amount;
    }
}
