package com.example.smsreader.parser;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

public class PatternBuilder {

    /**
     * Build a flexible regex from the original SMS body and confirmed fields.
     * Uses short keyword anchors before each field + .*? between fields.
     * This allows matching even when the exact wording varies between messages.
     */
    public static String buildRegex(String originalBody, List<DetectedField> fields) {
        List<DetectedField> sorted = new ArrayList<>(fields);
        Collections.sort(sorted, Comparator.comparingInt(DetectedField::getStartIndex));

        StringBuilder regex = new StringBuilder();
        regex.append("(?s)"); // DOTALL mode

        int pos = 0;
        for (int i = 0; i < sorted.size(); i++) {
            DetectedField field = sorted.get(i);

            // Extract a short anchor (last 1-2 keywords) from text before this field
            if (field.getStartIndex() > pos) {
                String textBefore = originalBody.substring(pos, field.getStartIndex());
                String anchor = extractAnchor(textBefore);
                if (i > 0) {
                    regex.append(".*?"); // flexible gap between fields
                }
                if (!anchor.isEmpty()) {
                    regex.append(escapeAnchor(anchor));
                    regex.append("\\s*");
                }
            } else if (i > 0) {
                regex.append(".*?");
            }

            // Add named capture group using the field type's general regex
            String groupName = sanitizeGroupName(field.getFieldName());
            String captureRegex = getFlexibleCaptureRegex(field.getFieldType());
            regex.append("(?<").append(groupName).append(">")
                 .append(captureRegex)
                 .append(")");

            pos = field.getEndIndex();
        }

        return regex.toString();
    }

    /**
     * Build a human-readable template showing {fieldName} placeholders.
     */
    public static String buildReadableTemplate(String originalBody, List<DetectedField> fields) {
        List<DetectedField> sorted = new ArrayList<>(fields);
        Collections.sort(sorted, Comparator.comparingInt(DetectedField::getStartIndex));

        StringBuilder template = new StringBuilder();
        int pos = 0;

        for (DetectedField field : sorted) {
            if (field.getStartIndex() > pos) {
                template.append(originalBody, pos, field.getStartIndex());
            }
            template.append("{").append(field.getFieldName()).append("}");
            pos = field.getEndIndex();
        }

        if (pos < originalBody.length()) {
            template.append(originalBody.substring(pos));
        }

        return template.toString();
    }

    /**
     * Extract a short anchor keyword from text preceding a field.
     * Takes the last meaningful word/phrase to anchor the field position.
     */
    private static String extractAnchor(String text) {
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return "";

        // Split into words, take the last 1-2 keywords
        String[] words = trimmed.split("\\s+");
        if (words.length == 0) return "";

        // Take last word (or last 2 if short)
        if (words.length >= 2) {
            String last = words[words.length - 1];
            String secondLast = words[words.length - 2];
            // If last word is very short (preposition, punctuation), include previous word
            if (last.length() <= 3) {
                return secondLast + " " + last;
            }
            return last;
        }
        return words[words.length - 1];
    }

    /**
     * Escape an anchor string for regex, allowing flexible whitespace.
     */
    private static String escapeAnchor(String anchor) {
        String[] parts = anchor.split("\\s+");
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            if (!parts[i].isEmpty()) {
                result.append(Pattern.quote(parts[i]));
            }
            if (i < parts.length - 1) {
                result.append("\\s+");
            }
        }
        return result.toString();
    }

    /**
     * Get a more flexible capture regex for each field type.
     * These are broader than the detection regexes to catch variations.
     */
    private static String getFlexibleCaptureRegex(FieldType type) {
        switch (type) {
            case AMOUNT:
                return "(?:Rs\\.?|INR|\\u20B9)?\\s*[0-9,]+\\.?\\d{0,2}";
            case ACCOUNT_NUMBER:
                return "(?:A/c|a/c|account|acct|A\\.C\\.)?[:\\s]*[Xx*]*\\d{4,}";
            case TRANSACTION_TYPE:
                return "(?:credited|debited|withdrawn|deposited|received|sent|transferred|reversed)";
            case BALANCE:
                return "(?:Rs\\.?|INR|\\u20B9)?\\s*[0-9,]+\\.?\\d{0,2}";
            case REFERENCE_ID:
                return "[A-Za-z0-9]{4,}";
            case DATE:
                return "\\d{1,2}[-/\\s](?:\\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\w*)[-/\\s]\\d{2,4}";
            case MERCHANT:
                return "[A-Za-z0-9][A-Za-z0-9 &.'-]{1,40}?";
            case CUSTOM:
                return ".+?";
            default:
                return ".+?";
        }
    }

    /**
     * Sanitize field name to be valid Java regex group name (alphanumeric only).
     */
    private static String sanitizeGroupName(String name) {
        return name.replaceAll("[^a-zA-Z0-9]", "");
    }
}
