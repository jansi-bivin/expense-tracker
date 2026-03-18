package com.example.smsreader.parser;

import com.example.smsreader.data.ExtractedTransactionEntity;
import com.example.smsreader.data.SmsPatternEntity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SmsMatcher {

    /**
     * Try to match an SMS body against a template regex.
     * Returns extracted field name-value pairs, or null if no match.
     */
    public static Map<String, String> matchSms(String body, String templateRegex) {
        try {
            Pattern p = Pattern.compile(templateRegex, Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
            Matcher m = p.matcher(body);
            if (m.find()) {
                Map<String, String> results = new HashMap<>();
                // Extract named groups from the field definitions
                // Since Java doesn't expose group names, we parse them from the regex
                Pattern groupPattern = Pattern.compile("\\(\\?<([a-zA-Z0-9]+)>");
                Matcher groupMatcher = groupPattern.matcher(templateRegex);
                while (groupMatcher.find()) {
                    String groupName = groupMatcher.group(1);
                    try {
                        String value = m.group(groupName);
                        if (value != null) {
                            results.put(groupName, value.trim());
                        }
                    } catch (IllegalArgumentException e) {
                        // Group not found in match
                    }
                }
                return results;
            }
        } catch (Exception e) {
            // Invalid regex or other error
        }
        return null;
    }

    /**
     * Find the first matching pattern for a given SMS body and sender.
     */
    public static SmsPatternEntity findMatchingPattern(String body, String sender, List<SmsPatternEntity> patterns) {
        for (SmsPatternEntity pattern : patterns) {
            if (senderMatches(sender, pattern.getSenderAddress())) {
                Map<String, String> result = matchSms(body, pattern.getTemplateRegex());
                if (result != null && !result.isEmpty()) {
                    return pattern;
                }
            }
        }
        return null;
    }

    /**
     * Extract a transaction from an SMS using a matched pattern.
     */
    public static ExtractedTransactionEntity extractTransaction(String body, String sender, long smsDate, String smsId, SmsPatternEntity pattern) {
        Map<String, String> fields = matchSms(body, pattern.getTemplateRegex());
        if (fields == null) return null;

        ExtractedTransactionEntity tx = new ExtractedTransactionEntity();
        tx.patternId = pattern.id;
        tx.smsId = smsId;
        tx.senderAddress = sender;
        tx.smsDate = smsDate;
        tx.rawBody = body;
        tx.createdAt = System.currentTimeMillis();

        // Extract known fields
        if (fields.containsKey("amount")) {
            tx.amount = parseAmount(fields.get("amount"));
        }
        if (fields.containsKey("type")) {
            tx.transactionType = inferTransactionType(fields.get("type"));
        }
        if (fields.containsKey("account")) {
            tx.accountNumber = fields.get("account");
        }
        if (fields.containsKey("merchant")) {
            tx.merchant = fields.get("merchant");
        }
        if (fields.containsKey("balance")) {
            tx.balance = parseAmount(fields.get("balance"));
        }
        if (fields.containsKey("reference")) {
            tx.referenceId = fields.get("reference");
        }
        if (fields.containsKey("date")) {
            tx.transactionDate = fields.get("date");
        }

        // Store all fields as JSON
        try {
            JSONObject json = new JSONObject();
            for (Map.Entry<String, String> entry : fields.entrySet()) {
                json.put(entry.getKey(), entry.getValue());
            }
            tx.extractedFieldsJson = json.toString();
        } catch (Exception e) {
            tx.extractedFieldsJson = "{}";
        }

        return tx;
    }

    public static boolean senderMatches(String smsSender, String patternSender) {
        if (smsSender == null || patternSender == null) return false;
        String s1 = smsSender.trim().toLowerCase();
        String s2 = patternSender.trim().toLowerCase();
        // Exact match
        if (s1.equals(s2)) return true;
        // Strip common prefixes (VM-, AD-, BZ-, etc.) for bank sender IDs
        String stripped1 = s1.replaceAll("^[a-z]{2}-", "");
        String stripped2 = s2.replaceAll("^[a-z]{2}-", "");
        if (stripped1.equals(stripped2)) return true;
        // One contains the other
        if (s1.contains(s2) || s2.contains(s1)) return true;
        return false;
    }

    private static double parseAmount(String amountStr) {
        if (amountStr == null) return 0;
        // Remove currency symbols and commas
        String cleaned = amountStr.replaceAll("[^0-9.]", "");
        try {
            return Double.parseDouble(cleaned);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String inferTransactionType(String typeStr) {
        if (typeStr == null) return "UNKNOWN";
        String lower = typeStr.toLowerCase();
        if (lower.contains("credit") || lower.contains("deposit") || lower.contains("receiv")) {
            return "CREDIT";
        }
        if (lower.contains("debit") || lower.contains("withdraw") || lower.contains("sent") || lower.contains("transfer")) {
            return "DEBIT";
        }
        if (lower.contains("revers")) {
            return "REVERSAL";
        }
        return "UNKNOWN";
    }
}
