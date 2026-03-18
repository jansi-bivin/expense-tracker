package com.example.smsreader.parser;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SmsFieldDetector {

    public static List<DetectedField> detectFields(String smsBody) {
        List<DetectedField> allFields = new ArrayList<>();

        allFields.addAll(detectTransactionType(smsBody));
        allFields.addAll(detectBalance(smsBody));
        allFields.addAll(detectAmounts(smsBody));
        allFields.addAll(detectAccountNumbers(smsBody));
        allFields.addAll(detectReferenceId(smsBody));
        allFields.addAll(detectDates(smsBody));
        allFields.addAll(detectMerchant(smsBody));

        return resolveOverlaps(allFields);
    }

    private static List<DetectedField> detectAmounts(String smsBody) {
        List<DetectedField> fields = new ArrayList<>();

        // Pattern 1: Amount with currency prefix (Rs., INR, ₹)
        // Uses \b before currency to avoid matching "SBINR..." reference numbers
        // Amount must be reasonable format: digits with optional commas, optional .XX decimal
        Pattern p1 = Pattern.compile("(?:^|\\b)(?:Rs\\.?|INR|\\u20B9)\\s*([0-9,]+\\.\\d{2}|[0-9,]+)", Pattern.CASE_INSENSITIVE);
        Matcher m1 = p1.matcher(smsBody);
        int count = 0;
        while (m1.find()) {
            // Validate: make sure the character before Rs/INR is not a letter (prevents SBINR match)
            int start = m1.start();
            if (start > 0 && Character.isLetter(smsBody.charAt(start - 1))) {
                continue; // Skip — this is part of a larger word like "SBINR"
            }
            String amountStr = m1.group(1);
            // Skip if amount has more than 10 digits (likely a reference number, not an amount)
            String digitsOnly = amountStr.replaceAll("[^0-9]", "");
            if (digitsOnly.length() > 10) {
                continue;
            }
            String name = (count == 0) ? "amount" : "amount_" + (count + 1);
            // Store capture group (digits only), not full match (which includes "Rs." prefix)
            fields.add(new DetectedField(name, FieldType.AMOUNT, amountStr, m1.start(), m1.end()));
            count++;
        }

        // Pattern 2: Amount without currency prefix — after "debited by", "credited by", "for Rs" etc.
        // Handles SBI format: "debited by 546.00"
        if (count == 0) {
            Pattern p2 = Pattern.compile("(?:debited|credited|withdrawn|deposited|received|transferred)\\s+(?:by|for|with|of)\\s+([0-9,]+\\.\\d{2})", Pattern.CASE_INSENSITIVE);
            Matcher m2 = p2.matcher(smsBody);
            while (m2.find()) {
                String name = (count == 0) ? "amount" : "amount_" + (count + 1);
                fields.add(new DetectedField(name, FieldType.AMOUNT, m2.group(1), m2.start(1), m2.end(1)));
                count++;
            }
        }

        return fields;
    }

    private static List<DetectedField> detectAccountNumbers(String smsBody) {
        List<DetectedField> fields = new ArrayList<>();
        // Pattern 1: Standard account formats - A/c, Acc, Account, Acct with masked digits
        // Handles: "Acct XX773", "A/C X6017", "Acc XX773", "a/c NNNNNNNNNNN00365", "A/c no. XX5678"
        Pattern p1 = Pattern.compile("(?:A/[cC]|a/c|account|acct?|A\\.C\\.)\\.?\\s*(?:no\\.?\\s*)?[:\\s]*[A-Za-z*Xx]*\\d{3,}", Pattern.CASE_INSENSITIVE);
        Matcher m1 = p1.matcher(smsBody);
        int count = 0;
        while (m1.find()) {
            String name = (count == 0) ? "account" : "account_" + (count + 1);
            fields.add(new DetectedField(name, FieldType.ACCOUNT_NUMBER, m1.group(), m1.start(), m1.end()));
            count++;
        }

        // Pattern 2: Card number format - "Debit Card 2251", "Credit Card x1234", "Card XX3456"
        if (count == 0) {
            Pattern p2 = Pattern.compile("(?:(?:debit|credit)\\s+)?card\\s+[Xx*]*\\d{4,}", Pattern.CASE_INSENSITIVE);
            Matcher m2 = p2.matcher(smsBody);
            while (m2.find()) {
                String name = (count == 0) ? "account" : "account_" + (count + 1);
                fields.add(new DetectedField(name, FieldType.ACCOUNT_NUMBER, m2.group(), m2.start(), m2.end()));
                count++;
            }
        }

        return fields;
    }

    private static List<DetectedField> detectTransactionType(String smsBody) {
        List<DetectedField> fields = new ArrayList<>();
        Pattern p = Pattern.compile("\\b(credited|debited|withdrawn|deposited|received|sent|transferred|reversed|spent)\\b", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(smsBody);
        if (m.find()) {
            fields.add(new DetectedField("type", FieldType.TRANSACTION_TYPE, m.group(), m.start(), m.end()));
        }
        return fields;
    }

    private static List<DetectedField> detectBalance(String smsBody) {
        List<DetectedField> fields = new ArrayList<>();
        // Handles: "Bal Rs. 51,365.42", "Avl Bal: INR 1000", "C. Bal Rs. 51,365.42", "Available Balance: Rs 500"
        Pattern p = Pattern.compile("(?:C\\.?\\s*)?(?:avl\\.?\\s*bal|available\\s*balance|bal\\.?)[:\\s]*(?:Rs\\.?|INR|\\u20B9)?\\s*([0-9,]+\\.?\\d{0,2})", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(smsBody);
        if (m.find()) {
            // Store capture group (digits only), not full match (which includes "Bal Rs." prefix)
            fields.add(new DetectedField("balance", FieldType.BALANCE, m.group(1), m.start(), m.end()));
        }
        return fields;
    }

    private static List<DetectedField> detectReferenceId(String smsBody) {
        List<DetectedField> fields = new ArrayList<>();
        // Handles: "Refno 607385410837", "UPI:600826077574", "UPI ref 123", "txn id ABC123"
        Pattern p = Pattern.compile("(?:ref\\.?\\s*(?:no\\.?)?|txn\\s*(?:id|no\\.?)?|UPI\\s*(?:ref)?|IMPS\\s*(?:ref)?)[:\\s]*([A-Za-z0-9]{6,})", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(smsBody);
        if (m.find()) {
            fields.add(new DetectedField("reference", FieldType.REFERENCE_ID, m.group(), m.start(), m.end()));
        }
        return fields;
    }

    private static List<DetectedField> detectDates(String smsBody) {
        List<DetectedField> fields = new ArrayList<>();

        // Pattern 0: YYYY-MM-DD (ISO format: "2026-03-15")
        Pattern p0 = Pattern.compile("\\b(\\d{4}[-/]\\d{2}[-/]\\d{2})\\b");
        Matcher m0 = p0.matcher(smsBody);
        if (m0.find()) {
            fields.add(new DetectedField("date", FieldType.DATE, m0.group(), m0.start(), m0.end()));
            return fields;
        }

        // Pattern 1: DD-MM-YYYY or DD/MM/YYYY or DD-MM-YY
        Pattern p1 = Pattern.compile("\\b(\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4})\\b");
        Matcher m1 = p1.matcher(smsBody);
        if (m1.find()) {
            fields.add(new DetectedField("date", FieldType.DATE, m1.group(), m1.start(), m1.end()));
            return fields;
        }

        // Pattern 2: DD-Mon-YY or DD-Mon-YYYY (ICICI format: "12-Mar-26")
        Pattern p2 = Pattern.compile("\\b(\\d{1,2}[-/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\w*[-/]\\d{2,4})\\b", Pattern.CASE_INSENSITIVE);
        Matcher m2 = p2.matcher(smsBody);
        if (m2.find()) {
            fields.add(new DetectedField("date", FieldType.DATE, m2.group(), m2.start(), m2.end()));
            return fields;
        }

        // Pattern 3: DDMonYY or DDMonYYYY (SBI format: "14Mar26")
        Pattern p3 = Pattern.compile("\\b(\\d{1,2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\w*\\d{2,4})\\b", Pattern.CASE_INSENSITIVE);
        Matcher m3 = p3.matcher(smsBody);
        if (m3.find()) {
            fields.add(new DetectedField("date", FieldType.DATE, m3.group(), m3.start(), m3.end()));
            return fields;
        }

        // Pattern 4: DD Mon YYYY (with spaces)
        Pattern p4 = Pattern.compile("\\b(\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\w*\\s+\\d{2,4})\\b", Pattern.CASE_INSENSITIVE);
        Matcher m4 = p4.matcher(smsBody);
        if (m4.find()) {
            fields.add(new DetectedField("date", FieldType.DATE, m4.group(), m4.start(), m4.end()));
            return fields;
        }

        // Pattern 5: DD/MM/YYYY format like "08/03/2026"
        Pattern p5 = Pattern.compile("\\b(\\d{2}/\\d{2}/\\d{4})\\b");
        Matcher m5 = p5.matcher(smsBody);
        if (m5.find()) {
            fields.add(new DetectedField("date", FieldType.DATE, m5.group(), m5.start(), m5.end()));
        }

        return fields;
    }

    private static List<DetectedField> detectMerchant(String smsBody) {
        List<DetectedField> fields = new ArrayList<>();

        // Pattern 1: ICICI UPI format - "; MERCHANT_NAME credited"
        Pattern p1 = Pattern.compile(";\\s*([A-Z][A-Za-z0-9 &.'-]{2,30})\\s+credited", Pattern.CASE_INSENSITIVE);
        Matcher m1 = p1.matcher(smsBody);
        if (m1.find()) {
            String merchant = m1.group(1).trim();
            fields.add(new DetectedField("merchant", FieldType.MERCHANT, merchant, m1.start(1), m1.end(1)));
            return fields;
        }

        // Pattern 2: SBI format - "trf to MERCHANT_NAME"
        Pattern p2 = Pattern.compile("(?:trf|transfer)\\s+to\\s+([A-Z][A-Za-z0-9 &.'-]{2,30})(?=\\s+Ref|\\s*$|[.,;])", Pattern.CASE_INSENSITIVE);
        Matcher m2 = p2.matcher(smsBody);
        if (m2.find()) {
            String merchant = m2.group(1).trim();
            fields.add(new DetectedField("merchant", FieldType.MERCHANT, merchant, m2.start(1), m2.end(1)));
            return fields;
        }

        // Pattern 3: "towards MERCHANT" (AutoPay format: "towards Amazon Pay for Amazon Prime")
        Pattern p3 = Pattern.compile("towards\\s+(?:Merchant\\s+)?([A-Z][A-Za-z0-9 &.'-]{2,30}?)(?=\\s+to\\s+be|\\s+is\\s+|[.,;]|$)", Pattern.CASE_INSENSITIVE);
        Matcher m3 = p3.matcher(smsBody);
        if (m3.find()) {
            String merchant = m3.group(1).trim();
            if (!isMerchantFalsePositive(merchant)) {
                fields.add(new DetectedField("merchant", FieldType.MERCHANT, merchant, m3.start(1), m3.end(1)));
                return fields;
            }
        }

        // Pattern 4: "Merchant MERCHANT_NAME" (Standing Instruction format)
        Pattern p4 = Pattern.compile("Merchant\\s+([A-Z][A-Za-z0-9 &.'-]{2,30})(?=[.,;\\s]|$)", Pattern.CASE_INSENSITIVE);
        Matcher m4 = p4.matcher(smsBody);
        if (m4.find()) {
            String merchant = m4.group(1).trim();
            if (!isMerchantFalsePositive(merchant)) {
                fields.add(new DetectedField("merchant", FieldType.MERCHANT, merchant, m4.start(1), m4.end(1)));
                return fields;
            }
        }

        // Pattern 5: "for MERCHANT" (e.g., "for Amazon Prime AutoPay")
        Pattern p5 = Pattern.compile("\\bfor\\s+([A-Z][A-Za-z0-9 &.'-]{2,30})(?=[.,;\\s]|$)", Pattern.CASE_INSENSITIVE);
        Matcher m5 = p5.matcher(smsBody);
        if (m5.find()) {
            String merchant = m5.group(1).trim();
            if (!isMerchantFalsePositive(merchant)) {
                fields.add(new DetectedField("merchant", FieldType.MERCHANT, merchant, m5.start(1), m5.end(1)));
                return fields;
            }
        }

        // Pattern 6: Merchant code format - "VSI*OPENAI", "PAYTM*Merchant" (asterisk-separated)
        Pattern p6a = Pattern.compile("\\b([A-Z]{2,}\\*[A-Z][A-Za-z0-9 ]+?)(?=\\s{2,}|\\s+C\\.|\\s+Avl|\\s+Bal|[.,;]|$)", Pattern.CASE_INSENSITIVE);
        Matcher m6a = p6a.matcher(smsBody);
        if (m6a.find()) {
            String merchant = m6a.group(1).trim();
            fields.add(new DetectedField("merchant", FieldType.MERCHANT, merchant, m6a.start(1), m6a.end(1)));
            return fields;
        }

        // Pattern 7: Generic - after "to ", "at " (but NOT "from" or "by" — too many false positives)
        Pattern p6 = Pattern.compile("(?:(?:to|at)\\s+)([A-Z][A-Za-z0-9 &.'-]{2,30})(?=[.,;\\s]|$)", Pattern.CASE_INSENSITIVE);
        Matcher m6 = p6.matcher(smsBody);
        while (m6.find()) {
            String merchant = m6.group(1).trim();
            if (isMerchantFalsePositive(merchant)) {
                continue;
            }
            fields.add(new DetectedField("merchant", FieldType.MERCHANT, m6.group(1), m6.start(1), m6.end(1)));
            break;
        }

        return fields;
    }

    private static boolean isMerchantFalsePositive(String merchant) {
        if (merchant == null) return true;
        String lower = merchant.toLowerCase().trim();
        // Single-word false positives
        if (lower.matches("(?i)your|the|a|an|this|that|bank|account|card|balance|amt|amount|date|ref|no|id|rs|inr|be|cancel|you|dispute")) {
            return true;
        }
        // Multi-word false positives — anything starting with bank name or containing "bank"
        if (lower.startsWith("icici") || lower.startsWith("sbi") || lower.startsWith("hdfc") ||
            lower.startsWith("idbi") || lower.startsWith("axis") || lower.startsWith("kotak") ||
            lower.startsWith("your ") || lower.startsWith("be ") ||
            lower.contains(" bank ") || lower.endsWith(" bank")) {
            return true;
        }
        return false;
    }

    private static List<DetectedField> resolveOverlaps(List<DetectedField> fields) {
        // Sort by start index
        Collections.sort(fields, Comparator.comparingInt(DetectedField::getStartIndex));

        List<DetectedField> resolved = new ArrayList<>();
        int lastEnd = -1;

        for (DetectedField field : fields) {
            if (field.getStartIndex() >= lastEnd) {
                resolved.add(field);
                lastEnd = field.getEndIndex();
            }
            // If overlapping, skip (earlier/more-specific detector wins)
        }

        return resolved;
    }
}
