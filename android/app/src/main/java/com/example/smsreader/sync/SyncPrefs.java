package com.example.smsreader.sync;

import android.content.Context;
import android.content.SharedPreferences;

/** Small persistent sync state. */
public final class SyncPrefs {

    private SyncPrefs() {}

    public static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("sync", Context.MODE_PRIVATE);
    }

    /**
     * Messages from before this moment are ignored. Set the first time this version
     * runs, so updating the app never re-uploads old messages.
     */
    public static long cutoff(Context c) {
        SharedPreferences p = sp(c);
        long v = p.getLong("ingest_since", 0);
        if (v == 0) {
            v = System.currentTimeMillis();
            p.edit().putLong("ingest_since", v).putLong("scan_mark", v).commit();
        }
        return v;
    }

    /** Inbox is checked from this time onwards (minus an overlap). */
    public static long scanMark(Context c) {
        long cutoff = cutoff(c);
        return sp(c).getLong("scan_mark", cutoff);
    }

    public static void setScanMark(Context c, long when) {
        sp(c).edit().putLong("scan_mark", when).apply();
    }

    /** Phone number entered at setup; identifies whose messages these are. */
    public static String phone(Context c) {
        return c.getSharedPreferences("sms_reader", Context.MODE_PRIVATE).getString("phone_number", null);
    }
}
