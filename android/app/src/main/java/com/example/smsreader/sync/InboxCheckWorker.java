package com.example.smsreader.sync;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Safety net: reads the SMS inbox since the last check and queues any bank SMS the
 * live receiver missed (app killed, phone rebooted...). Then triggers an upload,
 * which also reports the phone's sync health.
 */
public class InboxCheckWorker extends Worker {

    private static final String TAG = "InboxCheck";
    /** Re-read a little of the previous window in case the SMS app saved late. */
    private static final long OVERLAP_MS = 60L * 60 * 1000;

    public InboxCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        try {
            int added = scan(c);
            if (added > 0) Log.d(TAG, "Inbox check found " + added + " missed bank SMS");
        } catch (Exception e) {
            Log.w(TAG, "Inbox check failed", e);
        }
        SyncScheduler.enqueueUpload(c);
        return Result.success();
    }

    static int scan(Context c) {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) return 0;

        long since = Math.max(SyncPrefs.cutoff(c), SyncPrefs.scanMark(c) - OVERLAP_MS);
        long started = System.currentTimeMillis();
        int added = 0;

        try (Cursor cur = c.getContentResolver().query(
                Uri.parse("content://sms/inbox"),
                new String[]{"address", "body", "date"},
                "date > ?",
                new String[]{String.valueOf(since)},
                "date ASC")) {
            if (cur != null) {
                while (cur.moveToNext()) {
                    String address = cur.getString(0);
                    String body = cur.getString(1);
                    long date = cur.getLong(2);
                    if (address == null || body == null) continue;
                    if (!BankSenders.isBankAddress(address)) continue;
                    if (Ingest.add(c, "scan", address, body, date)) added++;
                }
            }
        }
        SyncPrefs.setScanMark(c, started);
        return added;
    }
}
