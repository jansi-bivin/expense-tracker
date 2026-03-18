package com.example.smsreader;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telephony.TelephonyManager;
import android.util.Log;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.LinearLayout;
import android.widget.Toast;
import android.view.Gravity;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Launcher activity. Handles permissions, phone number setup, then opens web app.
 * First launch: request permissions → capture phone number → register user → open web app.
 * Subsequent launches: open web app directly.
 */
public class PermissionActivity extends AppCompatActivity {

    private static final String TAG = "PermissionActivity";
    private static final int PERMISSION_REQUEST_CODE = 100;
    private static final String WEB_APP_URL = "https://exptrack-wine.vercel.app";
    private static final String ACTION_TOOLS = "com.example.smsreader.TOOLS";
    private static final String PREFS_NAME = "sms_reader";

    private TextView statusText;
    private boolean showTools = false;

    private static final Pattern KNOWN_BANK_SENDER = Pattern.compile(
        "^[A-Z]{2}-(ICICI[TB]?(-[ST])?|SBIUPI(-[ST])?|CBSSBI|SBIBNK|SBIINB|ATMSBI|SBIPSG|" +
        "HDFCBK|AXISBK|KOTAKB|IDBIBK(-[ST])?|PNBSMS|BOBTXN|CANBNK|INDBNK|UNBINB|FEDBK|" +
        "PAYTMB|YESBK|EPFOHO|ICICIB)",
        Pattern.CASE_INSENSITIVE
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        showTools = ACTION_TOOLS.equals(getIntent().getAction());

        // If permissions granted, phone set up, and not requesting tools → open web app
        if (!showTools && allPermissionsGranted() && hasPhoneNumber()) {
            clearBadgeAndOpenWebApp();
            return;
        }

        // Show UI for permissions, phone setup, or tools
        buildUI();

        if (!allPermissionsGranted()) {
            checkAndRequestPermissions();
        } else if (!hasPhoneNumber()) {
            showPhoneSetup();
        } else {
            showReady();
        }
    }

    private boolean hasPhoneNumber() {
        String phone = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString("phone_number", null);
        return phone != null && !phone.isEmpty();
    }

    private String getStoredPhoneNumber() {
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString("phone_number", null);
    }

    private void buildUI() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(48, 48, 48, 48);

        statusText = new TextView(this);
        statusText.setTextSize(18);
        statusText.setGravity(Gravity.CENTER);
        layout.addView(statusText);

        if (showTools) {
            LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            btnParams.topMargin = 48;

            Button syncBtn = new Button(this);
            syncBtn.setText("Sync Recent SMS (last 7 days)");
            syncBtn.setOnClickListener(v -> syncRecentSms());
            syncBtn.setLayoutParams(btnParams);
            layout.addView(syncBtn);

            LinearLayout.LayoutParams testParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            testParams.topMargin = 24;
            Button testBtn = new Button(this);
            testBtn.setText("Test Push to Supabase");
            testBtn.setOnClickListener(v -> testPush());
            testBtn.setLayoutParams(testParams);
            layout.addView(testBtn);

            LinearLayout.LayoutParams openParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            openParams.topMargin = 48;
            Button openBtn = new Button(this);
            openBtn.setText("Open Expense Tracker");
            openBtn.setOnClickListener(v -> clearBadgeAndOpenWebApp());
            openBtn.setLayoutParams(openParams);
            layout.addView(openBtn);
        }

        setContentView(layout);
    }

    private void showPhoneSetup() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(48, 96, 48, 48);

        TextView title = new TextView(this);
        title.setText("Setup ExpTrack");
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);
        layout.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("\nEnter your phone number and name.\nThis identifies whose expenses are whose.");
        subtitle.setTextSize(14);
        subtitle.setGravity(Gravity.CENTER);
        layout.addView(subtitle);

        // Try to auto-detect phone number
        String detectedPhone = "";
        try {
            TelephonyManager tm = (TelephonyManager) getSystemService(TELEPHONY_SERVICE);
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
                String line = tm.getLine1Number();
                if (line != null && !line.isEmpty()) {
                    detectedPhone = line;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not auto-detect phone number", e);
        }

        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        inputParams.topMargin = 48;

        EditText phoneInput = new EditText(this);
        phoneInput.setHint("+91XXXXXXXXXX");
        phoneInput.setText(detectedPhone);
        phoneInput.setInputType(android.text.InputType.TYPE_CLASS_PHONE);
        phoneInput.setLayoutParams(inputParams);
        layout.addView(phoneInput);

        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        nameParams.topMargin = 24;

        EditText nameInput = new EditText(this);
        nameInput.setHint("Your name");
        nameInput.setLayoutParams(nameParams);
        layout.addView(nameInput);

        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnParams.topMargin = 48;

        Button saveBtn = new Button(this);
        saveBtn.setText("Save & Continue");
        saveBtn.setLayoutParams(btnParams);
        saveBtn.setOnClickListener(v -> {
            String phone = phoneInput.getText().toString().trim();
            String name = nameInput.getText().toString().trim();

            if (phone.isEmpty() || name.isEmpty()) {
                Toast.makeText(this, "Both fields are required", Toast.LENGTH_SHORT).show();
                return;
            }

            // Normalize: ensure +91 prefix
            if (!phone.startsWith("+")) {
                if (phone.startsWith("91") && phone.length() > 10) {
                    phone = "+" + phone;
                } else {
                    phone = "+91" + phone;
                }
            }

            // Save locally
            String finalPhone = phone;
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString("phone_number", finalPhone)
                .putString("user_name", name)
                .apply();

            // Register in Supabase (async)
            saveBtn.setEnabled(false);
            saveBtn.setText("Saving...");
            Executors.newSingleThreadExecutor().execute(() -> {
                String result = SupabasePusher.registerUser(finalPhone, name);
                Log.d(TAG, "User registration: " + result);
                runOnUiThread(() -> {
                    clearBadgeAndOpenWebApp();
                });
            });
        });
        layout.addView(saveBtn);

        setContentView(layout);
    }

    private void clearBadgeAndOpenWebApp() {
        NotificationHelper.clearNotification(this);
        Intent webViewIntent = new Intent(this, WebViewActivity.class);
        startActivity(webViewIntent);
        finish();
    }

    private boolean allPermissionsGranted() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS)
                != PackageManager.PERMISSION_GRANTED) return false;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private void syncRecentSms() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "SMS permission not granted", Toast.LENGTH_SHORT).show();
            return;
        }

        String phoneNumber = getStoredPhoneNumber();
        statusText.setText("Scanning inbox for recent bank SMS...");
        Toast.makeText(this, "Syncing...", Toast.LENGTH_SHORT).show();

        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                long sevenDaysAgo = System.currentTimeMillis() - (7L * 24 * 60 * 60 * 1000);
                int pushed = 0;
                int skipped = 0;

                Cursor cursor = getContentResolver().query(
                    Uri.parse("content://sms/inbox"),
                    new String[]{"address", "body", "date"},
                    "date > ?",
                    new String[]{String.valueOf(sevenDaysAgo)},
                    "date DESC"
                );

                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        String address = cursor.getString(0);
                        String body = cursor.getString(1);
                        long date = cursor.getLong(2);

                        if (address == null || body == null) continue;

                        if (!KNOWN_BANK_SENDER.matcher(address).find()) {
                            skipped++;
                            continue;
                        }

                        long roundedDate = (date / 1000) * 1000;
                        String result = SupabasePusher.pushRawSmsSync(address, body, roundedDate, phoneNumber);
                        if (result.startsWith("OK")) {
                            pushed++;
                        }
                    }
                    cursor.close();
                }

                final int finalPushed = pushed;
                final int finalSkipped = skipped;
                runOnUiThread(() -> {
                    statusText.setText("Sync done!\n\n" + finalPushed + " bank SMS pushed\n" +
                        finalSkipped + " non-bank skipped\n\n" +
                        "Duplicates are automatically ignored by Supabase.");
                });

            } catch (Exception e) {
                Log.e(TAG, "Sync failed", e);
                runOnUiThread(() -> {
                    statusText.setText("Sync failed: " + e.getMessage());
                });
            }
        });
    }

    private void testPush() {
        String phoneNumber = getStoredPhoneNumber();
        Toast.makeText(this, "Pushing test SMS...", Toast.LENGTH_SHORT).show();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                String testSender = "VM-ICICIB";
                String testBody = "Your A/c XX773 is debited for Rs.100.00 on 16-Mar-26; Test Merchant credited. UPI:999999999999. Call 18002662 for dispute.";
                long now = (System.currentTimeMillis() / 1000) * 1000;

                String result = SupabasePusher.pushRawSmsSync(testSender, testBody, now, phoneNumber);
                Log.d(TAG, "Test push result: " + result);

                runOnUiThread(() -> {
                    statusText.setText("Push result: " + result);
                    Toast.makeText(this, "Result: " + result, Toast.LENGTH_LONG).show();
                });
            } catch (Exception e) {
                Log.e(TAG, "Test push failed", e);
                runOnUiThread(() -> {
                    Toast.makeText(this, "Push failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void checkAndRequestPermissions() {
        String[] permissions;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions = new String[]{
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS,
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.READ_PHONE_STATE,
                Manifest.permission.READ_PHONE_NUMBERS
            };
        } else {
            permissions = new String[]{
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS,
                Manifest.permission.READ_PHONE_STATE
            };
        }

        statusText.setText("Requesting permissions...");
        ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            boolean smsGranted = false;
            for (int i = 0; i < permissions.length; i++) {
                if (permissions[i].equals(Manifest.permission.RECEIVE_SMS) &&
                    grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                    smsGranted = true;
                }
            }
            if (smsGranted) {
                if (!hasPhoneNumber()) {
                    showPhoneSetup();
                } else {
                    clearBadgeAndOpenWebApp();
                }
            } else {
                statusText.setText("SMS permission is required.\n\nPlease grant SMS permission in Settings > Apps > ExpTrack > Permissions.");
            }
        }
    }

    private void showReady() {
        statusText.setText("SMS Sync is active.\n\nUse the tools below for diagnostics.");
    }
}
