package com.example.smsreader;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Full-screen WebView that loads the expense tracker web app.
 * Keeps all navigation inside the app — no external browser needed.
 * Clears notification badge when opened.
 */
public class WebViewActivity extends AppCompatActivity {

    private static final String TAG = "WebViewActivity";
    private static final String WEB_APP_URL = "https://exptrack-wine.vercel.app";
    private WebView webView;

    private static final Pattern KNOWN_BANK_SENDER = Pattern.compile(
        "^[A-Z]{2}-(ICICI[TB]?(-[ST])?|SBIUPI(-[ST])?|CBSSBI|SBIBNK|SBIINB|ATMSBI|SBIPSG|" +
        "HDFCBK|AXISBK|KOTAKB|IDBIBK(-[ST])?|PNBSMS|BOBTXN|CANBNK|INDBNK|UNBINB|FEDBK|" +
        "PAYTMB|YESBK|EPFOHO|ICICIB)",
        Pattern.CASE_INSENSITIVE
    );

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Clear notification + badge when user opens the app
        NotificationHelper.clearNotification(this);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Expose native bridge to JavaScript
        webView.addJavascriptInterface(new UpiPayBridge(), "AndroidUpi");

        // Handle navigation — keep everything inside WebView
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("upi".equals(uri.getScheme())) {
                    // Block upi:// links — they don't work for P2P
                    return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        // Pass phone number to web app for user identification
        String phone = getSharedPreferences("sms_reader", MODE_PRIVATE).getString("phone_number", "");
        String url = WEB_APP_URL;
        if (!phone.isEmpty()) {
            url += "?phone=" + android.net.Uri.encode(phone);
        }
        webView.loadUrl(url);
    }

    /**
     * JavaScript bridge — web app calls window.AndroidUpi.openApp(appName)
     * to launch the UPI app directly (home screen, not payment intent).
     */
    private class UpiPayBridge {
        @JavascriptInterface
        public void openApp(String appPackage) {
            runOnUiThread(() -> {
                try {
                    Intent intent = getPackageManager().getLaunchIntentForPackage(appPackage);
                    if (intent != null) {
                        startActivity(intent);
                    } else {
                        Toast.makeText(WebViewActivity.this, "App not installed", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(WebViewActivity.this, "Could not open app", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Clear notification whenever app comes to foreground
        NotificationHelper.clearNotification(this);
        // Catch-up sync: push any bank SMS from last 24h that the receiver might have missed
        catchUpSync();
    }

    /**
     * Background sync of recent bank SMS (last 24h).
     * Catches any SMS the BroadcastReceiver missed (doze, app killed, etc.).
     * Duplicates are ignored by Supabase (resolution=ignore-duplicates).
     */
    private void catchUpSync() {
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) return;

        String phoneNumber = getSharedPreferences("sms_reader", MODE_PRIVATE)
            .getString("phone_number", null);

        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                long oneDayAgo = System.currentTimeMillis() - (24L * 60 * 60 * 1000);
                int pushed = 0;

                Cursor cursor = getContentResolver().query(
                    Uri.parse("content://sms/inbox"),
                    new String[]{"address", "body", "date"},
                    "date > ?",
                    new String[]{String.valueOf(oneDayAgo)},
                    "date DESC"
                );

                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        String address = cursor.getString(0);
                        String body = cursor.getString(1);
                        long date = cursor.getLong(2);

                        if (address == null || body == null) continue;
                        if (!KNOWN_BANK_SENDER.matcher(address).find()) continue;

                        long roundedDate = (date / 1000) * 1000;
                        SupabasePusher.pushRawSmsSync(address, body, roundedDate, phoneNumber);
                        pushed++;
                    }
                    cursor.close();
                }

                if (pushed > 0) {
                    Log.d(TAG, "Catch-up sync: pushed " + pushed + " bank SMS from last 24h");
                }
            } catch (Exception e) {
                Log.e(TAG, "Catch-up sync failed", e);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
