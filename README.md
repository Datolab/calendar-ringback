# Google Calendar Callback Extension

A Chrome extension that monitors Google Calendar for upcoming meetings with Google Meet links and provides an "incoming call" experience to join meetings automatically.

## Overview

This extension transforms how you join Google Meet meetings by:
- Monitoring your Google Calendar for upcoming meetings
- Displaying a phone-like incoming call screen when a meeting is about to start
- Allowing you to answer (join), decline, or snooze the meeting notification
- Running in the background so you never miss an important call

## Features

- **Calendar Integration**: Authenticates with Google Calendar API and polls for upcoming events every 30 seconds
- **Meet Link Detection**: Automatically identifies events with Google Meet links
- **"Incoming Call" Experience**:
  - Full-screen overlay with phone call interface
  - Authentic ringtone
  - Meeting information display (title, time, participants)
  - Action buttons (Answer/Decline/Snooze)
- **Background Monitoring**:
  - Only triggers for meetings you've accepted
  - Anti-spam protection (max 1 notification per meeting)
  - Auto-dismisses after 2 minutes if not interacted with

## Installation

### From Chrome Web Store (Coming Soon)
1. Visit the Chrome Web Store
2. Search for "Google Calendar Callback"
3. Click "Add to Chrome"

### Developer Installation
1. Clone this repository
2. Create a Google Cloud Project and enable the Google Calendar API
3. Configure the OAuth consent screen and create OAuth credentials
4. Add your OAuth client ID to the `manifest.json` file
5. Open Chrome and navigate to `chrome://extensions`
6. Enable "Developer mode"
7. Click "Load unpacked" and select the extension directory

## Setup

On first run, the extension will:
1. Ask you to sign in with your Google account
2. Request permission to access your Google Calendar
3. Begin monitoring for upcoming meetings

## Configuration

The extension popup allows you to configure:
- Call notification timing (how many minutes before the meeting)
- Auto-join option (automatically open the meeting when answering)
- Ringtone selection

## Development

### Project Structure
```
manifest.json          # Extension configuration
background.js          # Service worker for background tasks
popup/
  ├── popup.html       # Extension popup UI
  ├── popup.js         # Popup logic
  └── popup.css        # Popup styling
call-overlay/
  ├── overlay.html     # Full-screen call interface
  ├── overlay.js       # Call handling logic
  └── overlay.css      # Call UI styling
assets/
  ├── ring-default.mp3 # Default phone ring sound
  ├── ring-classic.mp3 # Classic phone ring sound
  ├── ring-digital.mp3 # Digital ring sound
  └── icons/           # Extension icons
```

### Technologies Used
- Chrome Extensions API (Manifest V3)
- Google Calendar API
- Chrome Identity API for OAuth authentication
- Web Audio API for ringtone handling

## Privacy

This extension:
- Only requests the minimum calendar access needed (`calendar.readonly`)
- Does not send your data to any third-party servers
- Stores meeting information locally in your browser storage
- Only processes meetings with Google Meet links

## License

See the [LICENSE](LICENSE) file for details.
