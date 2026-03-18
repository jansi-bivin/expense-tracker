package com.example.smsreader;

import java.util.ArrayList;
import java.util.List;

public class SmsConversation {
    private String address;
    private String contactName;
    private String lastMessage;
    private long lastDate;
    private int messageCount;
    private List<SmsMessage> messages;

    public SmsConversation(String address, String contactName) {
        this.address = address;
        this.contactName = contactName;
        this.messages = new ArrayList<>();
        this.messageCount = 0;
    }

    public void addMessage(SmsMessage msg) {
        messages.add(msg);
        messageCount++;
        if (lastDate == 0 || msg.getDate() > lastDate) {
            lastDate = msg.getDate();
            lastMessage = msg.getBody();
        }
    }

    public String getAddress() { return address; }
    public String getContactName() { return contactName; }
    public String getLastMessage() { return lastMessage; }
    public long getLastDate() { return lastDate; }
    public int getMessageCount() { return messageCount; }
    public List<SmsMessage> getMessages() { return messages; }

    public String getDisplayName() {
        return (contactName != null && !contactName.isEmpty()) ? contactName : address;
    }
}
