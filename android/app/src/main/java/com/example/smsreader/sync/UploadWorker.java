package com.example.smsreader.sync;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.List;

/**
 * Uploads waiting messages. Before inserting, checks the server for the same text
 * from this phone within ±48h, so a message caught by two paths is saved once.
 * Ends by reporting the phone's sync health. Retries with backoff if offline.
 */
public class UploadWorker extends Worker {

    private static final int BATCH = 50;
    private static final int MAX_ROUNDS = 10;
    private static final int MAX_REJECTIONS = 5;
    private static final long KEEP_DONE_MS = 30L * 24 * 60 * 60 * 1000;

    public UploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        String phone = SyncPrefs.phone(c);
        if (phone == null || phone.isEmpty()) return Result.success(); // setup not finished

        OutboxDao dao = OutboxDatabase.get(c).dao();
        String error = null;

        for (int round = 0; round < MAX_ROUNDS; round++) {
            List<OutboxEntity> batch = dao.pending(BATCH);
            if (batch.isEmpty()) break;

            long from = Long.MAX_VALUE, to = Long.MIN_VALUE;
            for (OutboxEntity e : batch) {
                from = Math.min(from, e.smsDate);
                to = Math.max(to, e.smsDate);
            }
            List<String> onServer = SupabaseApi.normsBetween(phone, from - Ingest.WINDOW_MS, to + Ingest.WINDOW_MS);
            if (onServer == null) {
                error = "Server not reachable";
                break;
            }

            boolean progress = false;
            for (OutboxEntity e : batch) {
                long now = System.currentTimeMillis();
                boolean already = false;
                for (String s : onServer) {
                    if (BankSenders.sameMessage(s, e.norm)) { already = true; break; }
                }
                if (already) {
                    e.status = OutboxEntity.DUPLICATE;
                    e.uploadedAt = now;
                    dao.update(e);
                    progress = true;
                    continue;
                }

                int code = SupabaseApi.insert(e.address, e.body, e.smsDate, phone, e.source);
                if (code >= 200 && code < 300) {
                    e.status = OutboxEntity.SENT;
                    e.uploadedAt = now;
                    onServer.add(e.norm);
                    SyncPrefs.sp(c).edit().putLong("last_upload", now).apply();
                    progress = true;
                } else if (code == 409) {
                    e.status = OutboxEntity.DUPLICATE;
                    e.uploadedAt = now;
                    progress = true;
                } else {
                    e.attempts++;
                    e.lastError = code < 0 ? "network" : "HTTP " + code;
                    error = e.lastError;
                    if (code >= 400 && code < 500 && e.attempts >= MAX_REJECTIONS) {
                        e.status = OutboxEntity.FAILED; // the server keeps refusing this row
                    }
                }
                dao.update(e);
            }
            if (!progress) break;
        }

        Heartbeat.send(c, phone, dao, error);
        dao.prune(System.currentTimeMillis() - KEEP_DONE_MS);
        return error == null ? Result.success() : Result.retry();
    }
}
