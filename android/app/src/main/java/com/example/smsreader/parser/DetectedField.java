package com.example.smsreader.parser;

public class DetectedField {
    private String fieldName;
    private FieldType fieldType;
    private String value;
    private int startIndex;
    private int endIndex;

    public DetectedField(String fieldName, FieldType fieldType, String value, int startIndex, int endIndex) {
        this.fieldName = fieldName;
        this.fieldType = fieldType;
        this.value = value;
        this.startIndex = startIndex;
        this.endIndex = endIndex;
    }

    public String getFieldName() { return fieldName; }
    public void setFieldName(String fieldName) { this.fieldName = fieldName; }
    public FieldType getFieldType() { return fieldType; }
    public void setFieldType(FieldType fieldType) { this.fieldType = fieldType; }
    public String getValue() { return value; }
    public int getStartIndex() { return startIndex; }
    public int getEndIndex() { return endIndex; }
}
