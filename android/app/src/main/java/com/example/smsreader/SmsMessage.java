package com.example.smsreader;

public class SmsMessage {
    private String id;
    private String address;
    private String contactName;
    private String body;
    private long date;
    private int type; // 1 = inbox, 2 = sent

    public SmsMessage(String id, String address, String contactName, String body, long date, int type) {
        this.id = id;
        this.address = address;
        this.contactName = contactName;
        this.body = body;
        this.date = date;
        this.type = type;
    }

    public String getId() { return id; }
    public String getAddress() { return address; }
    public String getContactName() { return contactName; }
    public String getBody() { return body; }
    public long getDate() { return date; }
    public int getType() { return type; }

    public String getDisplayName() {
        return (contactName != null && !contactName.isEmpty()) ? contactName : address;
    }

    public boolean isIncoming() {
        return type == 1;
    }
}
