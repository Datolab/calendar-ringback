# Cross-Browser Testing Matrix

## Test Cases

| Test Case | Google Chrome | Microsoft Edge | Brave Browser | Opera | Notes |
|-----------|---------------|----------------|---------------|-------|-------|
| **Installation & Setup** | | | | | |
| Extension installs without errors | [ ] | [ ] | [ ] | [ ] | |
| First-run modal appears on initial installation | [ ] | [ ] | [ ] | [ ] | |
| OAuth consent flow works properly | [ ] | [ ] | [ ] | [ ] | |
| Permission grants are successful | [ ] | [ ] | [ ] | [ ] | |
| **Authentication** | | | | | |
| Sign-in button works correctly | [ ] | [ ] | [ ] | [ ] | |
| User email displays after authentication | [ ] | [ ] | [ ] | [ ] | |
| Sign-out functionality works | [ ] | [ ] | [ ] | [ ] | |
| Token refresh works when expired | [ ] | [ ] | [ ] | [ ] | |
| **Core Functionality** | | | | | |
| Calendar polling works in background | [ ] | [ ] | [ ] | [ ] | |
| Notifications appear for upcoming meetings | [ ] | [ ] | [ ] | [ ] | |
| Overlay appears for meeting events | [ ] | [ ] | [ ] | [ ] | |
| Ringtone plays correctly | [ ] | [ ] | [ ] | [ ] | |
| Answer button opens meeting link | [ ] | [ ] | [ ] | [ ] | |
| Decline button dismisses overlay | [ ] | [ ] | [ ] | [ ] | |
| Snooze button works as expected | [ ] | [ ] | [ ] | [ ] | |
| **Settings** | | | | | |
| Settings are saved properly | [ ] | [ ] | [ ] | [ ] | |
| Reminder time selection works | [ ] | [ ] | [ ] | [ ] | |
| Ringtone selection works | [ ] | [ ] | [ ] | [ ] | |
| Test sound button works | [ ] | [ ] | [ ] | [ ] | |
| Auto-join setting is respected | [ ] | [ ] | [ ] | [ ] | |
| **Edge Cases** | | | | | |
| Works after browser restart | [ ] | [ ] | [ ] | [ ] | |
| Handles multiple concurrent meetings | [ ] | [ ] | [ ] | [ ] | |
| Handles network interruptions | [ ] | [ ] | [ ] | [ ] | |
| Respects anti-spam settings | [ ] | [ ] | [ ] | [ ] | |

## Browser-Specific Notes

### Google Chrome

- Native environment, should work without issues

### Microsoft Edge

- Check if any Edge-specific API adjustments needed
- Verify manifest V3 compatibility

### Brave

- Test with Brave Shields enabled/disabled
- Check for any permission issues with strict privacy settings

### Opera

- Optional testing target
- Similar to Chrome but verify extension compatibility
