package com.example.smsreader.sync;

import android.content.Context;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/** Schedules the background jobs (WorkManager survives app kills and reboots). */
public final class SyncScheduler {

    private static final String UPLOAD = "outbox-upload";
    private static final String PERIODIC_CHECK = "inbox-check";
    private static final String CHECK_NOW = "inbox-check-now";

    private SyncScheduler() {}

    /** Upload whatever is waiting, as soon as there is internet; retries on failure. */
    public static void enqueueUpload(Context c) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(UploadWorker.class)
            .setConstraints(new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(c.getApplicationContext())
            .enqueueUniqueWork(UPLOAD, ExistingWorkPolicy.APPEND_OR_REPLACE, req);
    }

    /** Check the SMS inbox every 30 minutes for anything the live paths missed. */
    public static void ensurePeriodic(Context c) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(InboxCheckWorker.class, 30, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(c.getApplicationContext())
            .enqueueUniquePeriodicWork(PERIODIC_CHECK, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    /** Check the inbox right away (app opened, listener connected). */
    public static void checkNow(Context c) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(InboxCheckWorker.class).build();
        WorkManager.getInstance(c.getApplicationContext())
            .enqueueUniqueWork(CHECK_NOW, ExistingWorkPolicy.REPLACE, req);
    }
}
