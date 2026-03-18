# SMS Reader - Android App

A simple Android app that lists and displays SMS messages, grouped by conversation.

## Features

- **Conversation List** — All SMS threads grouped by contact/phone number, sorted by most recent
- **Contact Name Resolution** — Shows contact names when available, falls back to phone number
- **Search** — Filter conversations by name, number, or message content
- **Message Detail View** — Chat-bubble style thread view (incoming = white, outgoing = green)
- **Relative Timestamps** — "Just now", "5m ago", "2h ago", etc.
- **Message Count Badge** — Shows total messages per conversation
- **Runtime Permissions** — Properly requests READ_SMS and READ_CONTACTS at runtime

## Screenshots (expected)

| Conversation List | Message Thread |
|---|---|
| Blue header, search bar, rounded cards with avatar initials | Chat-bubble layout with incoming (white) and outgoing (green) bubbles |

## Project Structure

```
app/src/main/
├── AndroidManifest.xml          # Permissions & activity declarations
├── java/com/example/smsreader/
│   ├── MainActivity.java        # Conversation list screen
│   ├── SmsDetailActivity.java   # Message thread screen
│   ├── SmsHelper.java           # SMS content provider queries & contact lookup
│   ├── SmsMessage.java          # Message data model
│   ├── SmsConversation.java     # Conversation data model
│   ├── ConversationAdapter.java # RecyclerView adapter for conversation list
│   └── MessageAdapter.java      # RecyclerView adapter for message bubbles
└── res/
    ├── layout/
    │   ├── activity_main.xml           # Main screen layout
    │   ├── activity_sms_detail.xml     # Detail screen layout
    │   ├── item_conversation.xml       # Conversation list item
    │   ├── item_message_incoming.xml   # Incoming message bubble
    │   └── item_message_outgoing.xml   # Outgoing message bubble
    ├── drawable/                        # Shapes for bubbles, avatars, badges
    └── values/                          # Colors, strings, styles
```

## How to Build

1. **Open in Android Studio** — File → Open → select the `sms-app` folder
2. **Sync Gradle** — Android Studio will auto-sync dependencies
3. **Run on device** — Use a real device (emulator has no SMS data by default)
4. **Grant permissions** — Tap "Allow" when prompted for SMS and Contacts access

### Requirements

- Android Studio Hedgehog (2023.1) or newer
- Android SDK 34 (compileSdk)
- Min SDK 24 (Android 7.0+)
- Java 8

## Technical Notes

- Reads SMS via `content://sms` ContentProvider
- Contact names resolved via `ContactsContract.PhoneLookup`
- Phone numbers normalized by last 10 digits for grouping
- Loads up to 5000 most recent messages
- No external dependencies beyond AndroidX
- This is a **read-only** app — it does not send or delete messages

## Permissions

| Permission | Purpose |
|---|---|
| `READ_SMS` | Access SMS messages from the content provider |
| `READ_CONTACTS` | Resolve phone numbers to contact names |
