package com.example.smsreader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.example.smsreader.sync.BankSenders;
import com.example.smsreader.sync.Ingest;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Live SMS path. Saves each bank SMS to the on-phone outbox while Android still
 * holds the broadcast open (goAsync), so it survives the app being killed right
 * after. The upload itself runs as a WorkManager job with retries.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "SmsReceiver";
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        if (pdus == null) return;

        String format = bundle.getString("format");

        // Reassemble multi-part SMS
        StringBuilder fullBody = new StringBuilder();
        String sender = null;
        long smsTimestamp = System.currentTimeMillis();

        for (Object pdu : pdus) {
            android.telephony.SmsMessage sms = android.telephony.SmsMessage.createFromPdu((byte[]) pdu, format);
            if (sms == null) continue;
            if (sender == null) {
                sender = sms.getOriginatingAddress();
                smsTimestamp = sms.getTimestampMillis();
            }
            fullBody.append(sms.getMessageBody());
        }

        if (sender == null || fullBody.length() == 0) return;
        if (!BankSenders.isBankAddress(sender)) return;

        final String finalSender = sender;
        final String body = fullBody.toString();
        final long timestamp = smsTimestamp;
        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();

        EXEC.execute(() -> {
            try {
                Ingest.add(app, "sms", finalSender, body, timestamp);
            } catch (Exception e) {
                Log.e(TAG, "Could not queue bank SMS", e);
            } finally {
                pending.finish();
            }
        });
    }
}
