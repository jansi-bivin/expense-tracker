package com.example.smsreader;

import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Pushes raw bank SMS to Supabase.
 * Sends address, body, sms_date, and phone_number (user identifier).
 */
public class SupabasePusher {

    private static final String TAG = "SupabasePusher";
    private static final String SUPABASE_URL = "https://aeypofbcgzwdrejmrwpa.supabase.co";
    private static final String SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXBvZmJjZ3p3ZHJlam1yd3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NjAwNzAsImV4cCI6MjA4OTEzNjA3MH0.y1jRcxpbArTe8gg9juEI8mvltXdQ_CW4IVwbQMmap4w";

    private static final MediaType JSON_TYPE = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient client = new OkHttpClient();
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    /**
     * Push raw SMS to Supabase (async, fire-and-forget for SmsReceiver).
     */
    public static void pushRawSms(String address, String body, long smsDate, String phoneNumber) {
        executor.execute(() -> {
            String result = pushRawSmsSync(address, body, smsDate, phoneNumber);
            Log.d(TAG, "Async push result: " + result);
        });
    }

    /**
     * Push raw SMS to Supabase synchronously. Returns "OK" or error message.
     */
    public static String pushRawSmsSync(String address, String body, long smsDate, String phoneNumber) {
        try {
            JSONObject json = new JSONObject();
            json.put("address", address);
            json.put("body", body);
            json.put("sms_date", smsDate);
            if (phoneNumber != null && !phoneNumber.isEmpty()) {
                json.put("phone_number", phoneNumber);
            }

            Log.d(TAG, "Pushing: " + json.toString());

            RequestBody requestBody = RequestBody.create(json.toString(), JSON_TYPE);

            Request request = new Request.Builder()
                    .url(SUPABASE_URL + "/rest/v1/transactions")
                    .addHeader("apikey", SUPABASE_KEY)
                    .addHeader("Authorization", "Bearer " + SUPABASE_KEY)
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "resolution=ignore-duplicates")
                    .post(requestBody)
                    .build();

            try (Response response = client.newCall(request).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                if (response.isSuccessful()) {
                    Log.d(TAG, "Push OK: " + response.code());
                    return "OK (HTTP " + response.code() + ")";
                } else {
                    Log.e(TAG, "Push FAILED: " + response.code() + " " + responseBody);
                    return "FAILED: HTTP " + response.code() + " - " + responseBody;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Push exception", e);
            return "ERROR: " + e.getMessage();
        }
    }

    /**
     * Register user in Supabase users table (one-time on first launch).
     */
    public static String registerUser(String phoneNumber, String name) {
        try {
            JSONObject json = new JSONObject();
            json.put("phone_number", phoneNumber);
            json.put("name", name);

            RequestBody requestBody = RequestBody.create(json.toString(), JSON_TYPE);

            Request request = new Request.Builder()
                    .url(SUPABASE_URL + "/rest/v1/users")
                    .addHeader("apikey", SUPABASE_KEY)
                    .addHeader("Authorization", "Bearer " + SUPABASE_KEY)
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "resolution=ignore-duplicates")
                    .post(requestBody)
                    .build();

            try (Response response = client.newCall(request).execute()) {
                if (response.isSuccessful()) return "OK";
                return "FAILED: HTTP " + response.code();
            }
        } catch (Exception e) {
            return "ERROR: " + e.getMessage();
        }
    }
}
