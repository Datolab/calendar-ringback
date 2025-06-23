# Chrome Web Store Submission Guide

## Required Assets

### Store Listing

#### Basic Information
- **Extension Name**: Google Calendar Callback
- **Summary** (up to 132 characters): 
  Turn Google Calendar events with Meet links into phone-style incoming call notifications with ringtones.

#### Detailed Description
```
Google Calendar Callback transforms your calendar experience by treating upcoming Google Meet events like incoming phone calls.

FEATURES:
• Phone-like incoming call overlay for Google Calendar events with Meet links
• Customizable ringtones (Classic, Digital, Old Phone)
• Answer/Decline/Snooze options
• Configurable notification timing (1-10 minutes before event)
• Optional auto-join meeting on answer

HOW IT WORKS:
1. Grant calendar access during setup
2. The extension monitors your Google Calendar in the background
3. When an event with a Google Meet link is about to start, a full-screen overlay appears
4. Your selected ringtone plays until you take action
5. Answer to join the meeting, decline to dismiss, or snooze for later

WHY USE IT:
• Never miss important video calls while working in other tabs or applications
• Easily distinguish video meetings from other calendar notifications
• Feel like you're receiving an important call when it's time for your meeting

PRIVACY:
• All your calendar data stays on your device
• No data is sent to external servers
• Only requires minimal permissions to function

This extension is perfect for remote workers, virtual teams, students in online classes, or anyone who frequently uses Google Meet for video conferences.
```

#### Category
- **Primary**: Productivity
- **Secondary**: Business Tools

### Visual Assets

#### Icons
- Store Icon (128x128 PNG) - Already created in assets/icons/
- Small Promo Tile (440x280 PNG) - Need to create
- Large Promo Tile (920x680 PNG) - Need to create
- Marquee Promo Tile (1400x560 PNG) - Optional

#### Screenshots (1280x800 or 640x400)
1. Main popup showing signed-in state
2. Incoming call overlay with ringtone playing
3. Settings screen showing ringtone options
4. First-run welcome screen

### Privacy & Permissions

#### Permissions Justification
```
This extension requests the following permissions:

1. "identity" & "identity.email": Required to authenticate with Google Calendar API and display your email in the extension.

2. "storage": Needed to store your preferences (ringtone choice, reminder timing) and authentication tokens.

3. "alarms": Used to schedule checks for upcoming meetings at regular intervals.

4. "notifications": Allows the extension to show notifications for upcoming meetings.

5. "tabs" & "windows": Required to open the full-screen overlay when a meeting is about to start and to open Google Meet links when you click "Answer".

6. Host permissions for Google APIs: Necessary to fetch your calendar events from Google Calendar.

All data processing happens locally on your device. No personal data is sent to third-party servers.
```

#### Privacy Policy
Create a privacy.html file explaining data handling practices.

## Store Listing Checklist

- [ ] Extension name and description are clear and accurate
- [ ] All screenshots show actual extension functionality
- [ ] Promo images are properly sized and formatted
- [ ] Permission requests are properly justified
- [ ] Privacy policy is comprehensive and accurate
- [ ] Description includes concise explanation of features
- [ ] All text is free of spelling/grammar errors
