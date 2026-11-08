package com.example.smsreader.sync;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** Minimal Supabase REST calls used by the sync jobs. */
final class SupabaseApi {

    private static final String TAG = "SupabaseApi";
    private static final String REST = "https://aeypofbcgzwdrejmrwpa.supabase.co/rest/v1/";
    private static final String KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFleXBvZmJjZ3p3ZHJlam1yd3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NjAwNzAsImV4cCI6MjA4OTEzNjA3MH0.y1jRcxpbArTe8gg9juEI8mvltXdQ_CW4IVwbQMmap4w";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build();

    private SupabaseApi() {}

    private static Request.Builder request(String path) {
        return new Request.Builder()
            .url(REST + path)
            .addHeader("apikey", KEY)
            .addHeader("Authorization", "Bearer " + KEY);
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    /** Normalized bodies of this phone's rows in [from, to]; null if the server could not be reached. */
    static List<String> normsBetween(String phone, long from, long to) {
        String path = "transactions?select=body&phone_number=eq." + enc(phone)
            + "&sms_date=gte." + from + "&sms_date=lte." + to;
        try (Response r = CLIENT.newCall(request(path).get().build()).execute()) {
            if (!r.isSuccessful() || r.body() == null) return null;
            JSONArray rows = new JSONArray(r.body().string());
            List<String> out = new ArrayList<>(rows.length());
            for (int i = 0; i < rows.length(); i++) {
                out.add(BankSenders.normalize(rows.getJSONObject(i).optString("body", "")));
            }
            return out;
        } catch (Exception e) {
            Log.w(TAG, "Could not read existing rows", e);
            return null;
        }
    }

    /** Insert one message. Returns the HTTP status (2xx saved, 409 exact duplicate) or -1 on network error. */
    static int insert(String address, String body, long smsDate, String phone, String source) {
        try {
            JSONObject row = new JSONObject();
            row.put("address", address);
            row.put("body", body);
            row.put("sms_date", smsDate);
            if (phone != null && !phone.isEmpty()) row.put("phone_number", phone);
            row.put("device_id", source);
            Request req = request("transactions")
                .addHeader("Prefer", "return=minimal")
                .post(RequestBody.create(row.toString(), JSON))
                .build();
            try (Response r = CLIENT.newCall(req).execute()) {
                if (!r.isSuccessful() && r.code() != 409) {
                    Log.w(TAG, "Insert failed: HTTP " + r.code() + " " + (r.body() != null ? r.body().string() : ""));
                }
                return r.code();
            }
        } catch (Exception e) {
            Log.w(TAG, "Insert failed", e);
            return -1;
        }
    }

    /** Write a settings row by key: update it if it exists, otherwise insert it. */
    static boolean saveSetting(String key, JSONObject value) {
        try {
            String id = null;
            try (Response r = CLIENT.newCall(
                    request("settings?select=id&key=eq." + enc(key) + "&limit=1").get().build()).execute()) {
                if (!r.isSuccessful() || r.body() == null) return false;
                JSONArray rows = new JSONArray(r.body().string());
                if (rows.length() > 0) id = String.valueOf(rows.getJSONObject(0).get("id"));
            }
            JSONObject row = new JSONObject();
            row.put("value", value);
            row.put("updated_at", isoNow());
            Request req;
            if (id != null) {
                req = request("settings?id=eq." + enc(id))
                    .addHeader("Prefer", "return=minimal")
                    .patch(RequestBody.create(row.toString(), JSON))
                    .build();
            } else {
                row.put("key", key);
                req = request("settings")
                    .addHeader("Prefer", "return=minimal")
                    .post(RequestBody.create(row.toString(), JSON))
                    .build();
            }
            try (Response r = CLIENT.newCall(req).execute()) {
                return r.isSuccessful();
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not save setting " + key, e);
            return false;
        }
    }

    private static String isoNow() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }
}
