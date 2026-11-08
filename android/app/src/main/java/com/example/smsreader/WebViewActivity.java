package com.example.smsreader;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.io.OutputStream;

import com.example.smsreader.sync.SyncScheduler;

/**
 * Full-screen WebView that loads the expense tracker web app.
 * Keeps all navigation inside the app — no external browser needed.
 * Clears notification badge when opened.
 */
public class WebViewActivity extends AppCompatActivity {

    private static final String TAG = "WebViewActivity";
    private static final String WEB_APP_URL = "https://exptrack-wine.vercel.app";
    private WebView webView;
    private AlertDialog setupDialog;

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

        // WebView ignores downloads, so hand them (the APK update link) to the
        // phone's browser, which downloads the file and offers to install it.
        webView.setDownloadListener((downloadUrl, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(downloadUrl)));
            } catch (Exception e) {
                Toast.makeText(this, "Open exptrack-wine.vercel.app in your browser to download", Toast.LENGTH_LONG).show();
            }
        });

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

        /** True when saveQrAndOpen can save to the gallery (Android 10+, no permission needed). */
        @JavascriptInterface
        public boolean canSaveQr() {
            return Build.VERSION.SDK_INT >= 29;
        }

        /**
         * Saves a payment QR (base64 PNG) as the newest picture in the gallery, then opens
         * the UPI app. The user scans it from the gallery inside the UPI app: UPI refuses
         * payments to a person that another app starts, but allows ones the user starts.
         * Earlier QRs saved by this app are removed so the newest is the only one.
         */
        @JavascriptInterface
        public boolean saveQrAndOpen(String base64Png, String appPackage) {
            boolean saved = false;
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    byte[] png = Base64.decode(base64Png, Base64.DEFAULT);
                    ContentResolver cr = getContentResolver();
                    Uri images = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                    cr.delete(images,
                        MediaStore.Images.Media.RELATIVE_PATH + "=? AND " + MediaStore.Images.Media.DISPLAY_NAME + " LIKE ?",
                        new String[]{QR_DIR, "exptrack-pay-%"});
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, "exptrack-pay-" + System.currentTimeMillis() + ".png");
                    v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                    v.put(MediaStore.Images.Media.RELATIVE_PATH, QR_DIR);
                    v.put(MediaStore.Images.Media.IS_PENDING, 1);
                    Uri item = cr.insert(images, v);
                    if (item != null) {
                        try (OutputStream out = cr.openOutputStream(item)) {
                            out.write(png);
                        }
                        v.clear();
                        v.put(MediaStore.Images.Media.IS_PENDING, 0);
                        cr.update(item, v, null, null);
                        saved = true;
                    }
                } catch (Exception e) {
                    android.util.Log.w(TAG, "Could not save QR", e);
                }
            }
            final boolean ok = saved;
            runOnUiThread(() -> {
                Toast.makeText(WebViewActivity.this,
                    ok ? "QR saved. Scan → gallery → pick the newest picture" : "Could not save QR",
                    Toast.LENGTH_LONG).show();
                openApp(appPackage);
            });
            return saved;
        }
    }

    private static final String QR_DIR = "Pictures/ExpTrack/";

    @Override
    protected void onResume() {
        super.onResume();
        // Clear notification whenever app comes to foreground
        NotificationHelper.clearNotification(this);
        // Check the inbox for anything missed since the last check, then upload
        SyncScheduler.checkNow(this);
        // Walk through any phone setting that would stop background syncing
        setupDialog = SetupCheck.maybePrompt(this, setupDialog);
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
