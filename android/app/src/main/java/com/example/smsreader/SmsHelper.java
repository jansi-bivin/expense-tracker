package com.example.smsreader;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.telephony.PhoneNumberUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class SmsHelper {

    /**
     * Read all SMS messages, grouped into conversations by address.
     */
    public static List<SmsConversation> getConversations(Context context, int limit) {
        Map<String, SmsConversation> conversationMap = new LinkedHashMap<>();
        ContentResolver resolver = context.getContentResolver();

        Uri uri = Uri.parse("content://sms");
        String[] projection = {"_id", "address", "body", "date", "type"};
        String sortOrder = "date DESC";

        Cursor cursor = resolver.query(uri, projection, null, null, sortOrder);
        if (cursor == null) return new ArrayList<>();

        int count = 0;
        while (cursor.moveToNext() && count < limit) {
            String id = cursor.getString(cursor.getColumnIndexOrThrow("_id"));
            String address = cursor.getString(cursor.getColumnIndexOrThrow("address"));
            String body = cursor.getString(cursor.getColumnIndexOrThrow("body"));
            long date = cursor.getLong(cursor.getColumnIndexOrThrow("date"));
            int type = cursor.getInt(cursor.getColumnIndexOrThrow("type"));

            if (address == null) address = "Unknown";

            String normalizedAddr = normalizeAddress(address);
            String contactName = getContactName(context, address);

            SmsMessage msg = new SmsMessage(id, address, contactName, body, date, type);

            SmsConversation conv = conversationMap.get(normalizedAddr);
            if (conv == null) {
                conv = new SmsConversation(address, contactName);
                conversationMap.put(normalizedAddr, conv);
            }
            conv.addMessage(msg);
            count++;
        }
        cursor.close();

        return new ArrayList<>(conversationMap.values());
    }

    /**
     * Get all messages for a specific address.
     * Uses SQL WHERE clause to filter at the database level for speed.
     */
    public static List<SmsMessage> getMessagesForAddress(Context context, String address) {
        List<SmsMessage> messages = new ArrayList<>();
        ContentResolver resolver = context.getContentResolver();

        Uri uri = Uri.parse("content://sms");
        String[] projection = {"_id", "address", "body", "date", "type"};
        String sortOrder = "date ASC";

        // Try to filter at SQL level first using address LIKE
        String selection = "address LIKE ?";
        String[] selectionArgs;

        String normalizedTarget = normalizeAddress(address);
        // For alphanumeric senders (bank IDs like VM-HDFCBK), use LIKE %core%
        String digits = address.replaceAll("[^0-9+]", "");
        if (digits.isEmpty()) {
            // Alphanumeric sender - strip prefix and search by core name
            String core = address.replaceAll("^[A-Za-z]{2}-", "").trim();
            selectionArgs = new String[]{"%" + core + "%"};
        } else {
            // Phone number - search by last digits
            String lastDigits = normalizedTarget.length() > 6 ?
                normalizedTarget.substring(normalizedTarget.length() - 7) : normalizedTarget;
            selectionArgs = new String[]{"%" + lastDigits + "%"};
        }

        // Look up contact name once, not per message
        String contactName = getContactName(context, address);

        Cursor cursor = resolver.query(uri, projection, selection, selectionArgs, sortOrder);
        if (cursor == null) return messages;

        while (cursor.moveToNext()) {
            String msgAddr = cursor.getString(cursor.getColumnIndexOrThrow("address"));
            if (msgAddr == null) continue;

            // Double-check with normalization (SQL LIKE may match extras)
            if (normalizeAddress(msgAddr).equals(normalizedTarget)) {
                String id = cursor.getString(cursor.getColumnIndexOrThrow("_id"));
                String body = cursor.getString(cursor.getColumnIndexOrThrow("body"));
                long date = cursor.getLong(cursor.getColumnIndexOrThrow("date"));
                int type = cursor.getInt(cursor.getColumnIndexOrThrow("type"));

                messages.add(new SmsMessage(id, msgAddr, contactName, body, date, type));
            }
        }
        cursor.close();

        return messages;
    }

    /**
     * Look up contact name from phone number.
     */
    public static String getContactName(Context context, String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isEmpty()) return null;

        Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber));

        try (Cursor cursor = context.getContentResolver().query(
                uri,
                new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME},
                null, null, null)) {

            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(
                        cursor.getColumnIndexOrThrow(ContactsContract.PhoneLookup.DISPLAY_NAME));
            }
        } catch (Exception e) {
            // Ignore lookup failures
        }
        return null;
    }

    private static String normalizeAddress(String address) {
        if (address == null) return "";
        // Remove non-digit chars for comparison
        String digits = address.replaceAll("[^0-9+]", "");
        if (digits.length() > 10) {
            return digits.substring(digits.length() - 10);
        }
        return digits.isEmpty() ? address.toLowerCase().trim() : digits;
    }
}
