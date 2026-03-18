package com.example.smsreader;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Background-only SMS receiver.
 * Catches incoming bank SMS and pushes raw (address, body, sms_date) to Supabase.
 * No field detection, no Room DB — all intelligence lives in the web app.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "SmsReceiver";

    // Known bank sender pattern — only process SMS from real banks
    private static final Pattern KNOWN_BANK_SENDER = Pattern.compile(
        "^[A-Z]{2}-(ICICI[TB]?(-[ST])?|SBIUPI(-[ST])?|CBSSBI|SBIBNK|SBIINB|ATMSBI|SBIPSG|" +
        "HDFCBK|AXISBK|KOTAKB|IDBIBK(-[ST])?|PNBSMS|BOBTXN|CANBNK|INDBNK|UNBINB|FEDBK|" +
        "PAYTMB|YESBK|EPFOHO|ICICIB)",
        Pattern.CASE_INSENSITIVE
    );

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
            if (sender == null) {
                sender = sms.getOriginatingAddress();
                smsTimestamp = sms.getTimestampMillis();
            }
            fullBody.append(sms.getMessageBody());
        }

        if (sender == null || fullBody.length() == 0) return;

        String finalSender = sender;
        String body = fullBody.toString();
        long finalTimestamp = (smsTimestamp / 1000) * 1000; // Round to nearest second

        // Only process known bank senders
        if (!KNOWN_BANK_SENDER.matcher(finalSender).find()) return;

        // Push raw SMS to Supabase — no field detection, no local DB
        String phoneNumber = context.getSharedPreferences("sms_reader", Context.MODE_PRIVATE)
            .getString("phone_number", null);

        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                SupabasePusher.pushRawSms(finalSender, body, finalTimestamp, phoneNumber);
                Log.d(TAG, "Pushed bank SMS to Supabase: " + finalSender);

                // Extract amount for notification display
                java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("(?:Rs\\.?|INR|₹)\\s*([0-9,]+\\.?\\d{0,2})", java.util.regex.Pattern.CASE_INSENSITIVE)
                    .matcher(body);
                String amount = m.find() ? m.group(1) : "?";

                // Determine debit/credit
                String type = "Transaction";
                if (body.toLowerCase().contains("debit")) type = "Debited";
                else if (body.toLowerCase().contains("credit")) type = "Credited";

                NotificationHelper.showTransactionNotification(
                    context, type + " Rs." + amount, "Tap to categorize"
                );
            } catch (Exception e) {
                Log.e(TAG, "Failed to push SMS", e);
            }
        });
    }
}
