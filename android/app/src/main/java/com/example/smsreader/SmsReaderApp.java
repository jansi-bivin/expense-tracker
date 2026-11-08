package com.example.smsreader;

import android.app.Application;
import android.util.Log;

import com.example.smsreader.sync.SyncPrefs;
import com.example.smsreader.sync.SyncScheduler;

/** Runs first in every process start (receiver, listener or screen). */
public class SmsReaderApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        SyncPrefs.cutoff(this); // first run of this version: start from now, no backfill
        try {
            SyncScheduler.ensurePeriodic(this);
        } catch (Exception e) {
            Log.w("SmsReaderApp", "Could not schedule inbox check", e);
        }
    }
}
