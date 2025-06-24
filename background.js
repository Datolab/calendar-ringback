// Google Calendar Callback Extension - Background Service Worker
// Responsible for calendar monitoring and triggering call notifications

// Import the AuthService
import authService from './popup/services/auth.service.js';

// Error handling for service worker
function logError(error, context = 'general') {
  console.error(`Calendar Callback Error [${context}]:`, error);
  
  // Store error in chrome.storage for later reporting
  chrome.storage.local.get('error_logs', (data) => {
    const logs = data.error_logs || [];
    logs.unshift({
      timestamp: new Date().toISOString(),
      error: error.message || String(error),
      stack: error.stack,
      context
    });
    
    // Limit log size
    if (logs.length > 50) logs.length = 50;
    
    chrome.storage.local.set({ 'error_logs': logs });
  });
}

// Configuration
const CONFIG = {
  POLLING_INTERVAL: 30, // seconds
  UPCOMING_EVENT_THRESHOLD: 10, // minutes to look ahead for events
  CALL_TRIGGER_THRESHOLD: 5, // minutes before event to trigger call
  ALARM_OFFSET: 30 // seconds before event to trigger alarm
};

// State
let isAuthenticated = false;
let upcomingEvents = [];

// Initialize the extension
async function initialize() {
  console.log('Calendar Callback Extension: Initializing background service worker');
  
  // Initialize auth service first
  await authService.initialize();
  
  // Check for authentication status
  await checkAuthStatus();
  
  // Set up alarm for regular polling
  chrome.alarms.create('calendarPolling', {
    periodInMinutes: CONFIG.POLLING_INTERVAL / 60
  });
  
  // Listen for alarm events
  chrome.alarms.onAlarm.addListener(handleAlarm);
}

// Check OAuth authentication status
async function checkAuthStatus(interactive = false) {
  try {
    console.log(`Checking auth status (interactive: ${interactive})`);
    
    // Use authService to check authentication status
    isAuthenticated = await authService.isAuthenticated();
    
    // If not authenticated and interactive mode is allowed, try interactive auth
    if (!isAuthenticated && interactive) {
      console.log('Not authenticated, trying interactive authentication...');
      try {
        await authService.signIn();
        isAuthenticated = await authService.isAuthenticated();
      } catch (authError) {
        console.error('Interactive authentication failed:', authError);
        isAuthenticated = false;
      }
    }
    
    if (isAuthenticated) {
      console.log('User is authenticated, starting calendar monitoring');
      fetchUpcomingEvents();
      
      // Get user info
      try {
        const userInfo = await authService.getUserInfo(true); // silent mode
        console.log('User authenticated as:', userInfo.email);
      } catch (e) {
        // Ignore errors when getting user info
      }
      
      // Safely notify popup that authentication was successful
      await safelySendMessageToPopup({ action: 'authUpdated', authenticated: true });
    } else if (interactive) {
      console.log('Interactive authentication failed');
      // Notify popup that authentication failed
      await safelySendMessageToPopup({ 
        action: 'authUpdated', 
        authenticated: false,
        error: 'Failed to authenticate. Please try again.'
      });
    } else {
      console.log('User is not authenticated');
      // Notify popup that we need authentication
      await safelySendMessageToPopup({ 
        action: 'authNeeded',
        message: 'Please sign in to continue.'
      });
    }
    
    return isAuthenticated;
  } catch (error) {
    console.error('Error checking authentication status:', error);
    logError(error, 'auth_check');
    // Notify popup about the error
    await safelySendMessageToPopup({
      action: 'authError',
      error: error.message || 'Unknown authentication error'
    });
    return false;
  }
}

/**
 * Safely sends a message to the popup if it's open
 * @param {Object} message - The message to send
 * @returns {Promise} - A promise that resolves when the message is sent or ignored
 */
async function safelySendMessageToPopup(message) {
  return new Promise((resolve) => {
    try {
      // In MV3, we can't check if popup is open with getViews
      // Just try to send the message and handle any errors
      chrome.runtime.sendMessage(message, (response) => {
        // Handle any response or error
        if (chrome.runtime.lastError) {
          // This is normal if popup isn't open - don't treat as error
          console.log('Info: Message not delivered (popup likely closed):', 
                      chrome.runtime.lastError.message);
        } else if (response) {
          console.log('Popup response:', response);
        }
        resolve();
      });
    } catch (error) {
      console.log('Error sending message to popup:', error);
      resolve(); // Always resolve to avoid hanging promises
    }
  });
}

// Handle alarms
async function handleAlarm(alarm) {
  if (alarm.name === 'calendarPolling') {
    if (isAuthenticated) {
      await fetchUpcomingEvents();
    }
  } else if (alarm.name.startsWith('eventReminder_')) {
    const eventId = alarm.name.replace('eventReminder_', '');
    triggerCallOverlay(eventId);
  }
}

// Fetch upcoming calendar events with pagination support
async function fetchUpcomingEvents() {
  try {
    // Get token from AuthService
    const token = authService.getToken();
    if (!token) {
      console.log('No auth token available, skipping calendar fetch');
      return;
    }
    
    // Calculate time range for API query
    const now = new Date();
    const timeMin = now.toISOString();
    
    const future = new Date(now);
    future.setMinutes(now.getMinutes() + CONFIG.UPCOMING_EVENT_THRESHOLD);
    const timeMax = future.toISOString();
    
    console.log(`Fetching calendar events from ${timeMin} to ${timeMax}`);
    
    // Initialize storage for all events
    let allEvents = [];
    let nextPageToken = null;
    let pageCount = 0;
    const MAX_PAGES = 5; // Safety limit to prevent infinite loops
    
    // Process pages until we have all events or hit the max page limit
    do {
      // Build URL with pagination token if we have one
      let url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;
      
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
        console.log(`Fetching additional page ${pageCount + 1} of calendar events`);
      }
      
      // Make API call to Google Calendar
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        // Handle 401 unauthorized (expired token)
        if (response.status === 401) {
          console.log('Token expired (401), attempting to refresh...');
          // Use AuthService to refresh the token
          await authService.refreshToken();
          
          // Retry the fetch with new token
          return fetchUpcomingEvents();
        }
        
        throw new Error(`Calendar API error: ${response.status} - ${await response.text()}`);
      }
      
      const data = await response.json();
      pageCount++;
      
      // Process the current page of results
      if (data.items && data.items.length > 0) {
        allEvents = allEvents.concat(data.items);
        console.log(`Added ${data.items.length} events from page ${pageCount}, total: ${allEvents.length}`);
      }
      
      // Get the next page token if available
      nextPageToken = data.nextPageToken || null;
      
    } while (nextPageToken && pageCount < MAX_PAGES);
    
    if (pageCount >= MAX_PAGES && nextPageToken) {
      console.warn(`Reached maximum page limit (${MAX_PAGES}). Some events may not be processed.`);
    }
    
    // If we didn't find any events at all
    if (allEvents.length === 0) {
      console.log('No upcoming events found');
      return;
    }
    
    // Process all the events we found
    console.log(`Successfully fetched ${allEvents.length} calendar events`);
    
    // Use the events as if they came from a single request
    const data = { items: allEvents };
    
    // Filter for events with Google Meet links
    const eventsWithMeet = data.items.filter(event => {
      try {
        // Check if user has accepted the event
        const selfAttendee = event.attendees?.find(attendee => attendee.self);
        const hasAccepted = !selfAttendee || selfAttendee.responseStatus === 'accepted';
        
        // Check for Google Meet link
        const hasMeetLink = event.hangoutLink || 
                           (event.conferenceData?.conferenceId && 
                            event.conferenceData?.conferenceSolution?.name === 'Google Meet');
                            
        return hasAccepted && hasMeetLink;
      } catch (eventError) {
        // Handle malformed events gracefully
        console.warn('Skipping malformed event:', eventError.message, event.id || 'unknown ID');
        logError(eventError, 'event_processing');
        return false;
      }
    });
    
    console.log(`Found ${eventsWithMeet.length} upcoming events with Google Meet links`);
    processUpcomingEvents(eventsWithMeet);
    
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    logError(error, 'calendar_fetch');
    
    // Handle specific error types
    if (error.message && error.message.includes('quota')) {
      console.warn('Calendar API quota exceeded. Will retry on next polling cycle.');
      // Store error state for UI feedback
      chrome.storage.local.set({
        calendarApiState: {
          lastError: 'quota_exceeded',
          timestamp: Date.now(),
          message: 'Calendar API quota exceeded. Will retry automatically.'
        }
      });
    } else if (error.message && (error.message.includes('network') || error.message.includes('failed'))) {
      console.warn('Network error when fetching events. Will retry on next polling cycle.');
      // Store error state for UI feedback
      chrome.storage.local.set({
        calendarApiState: {
          lastError: 'network_error',
          timestamp: Date.now(),
          message: 'Network error. Will retry automatically.'
        }
      });
    } else {
      // Generic error handling
      chrome.storage.local.set({
        calendarApiState: {
          lastError: 'unknown_error',
          timestamp: Date.now(),
          message: error.message || 'Unknown error fetching calendar data.'
        }
      });
    }
  } finally {
    // Always update the last fetch timestamp regardless of success/failure
    chrome.storage.local.set({
      lastCalendarFetch: Date.now()
    });
  }
}

// Process the list of upcoming events
function processUpcomingEvents(events) {
  // Enhanced event processing with better logging
  console.log(`Processing ${events.length} upcoming events`);
  
  // Handle recurring events more intelligently
  // Group events by their recurring event ID if available
  const groupedEvents = {};
  const nonRecurringEvents = [];
  
  events.forEach(event => {
    // Check if it's part of a recurring series
    if (event.recurringEventId) {
      if (!groupedEvents[event.recurringEventId]) {
        groupedEvents[event.recurringEventId] = [];
      }
      groupedEvents[event.recurringEventId].push(event);
    } else {
      nonRecurringEvents.push(event);
    }
  });
  
  // Log recurring event stats if any found
  const recurringSeriesCount = Object.keys(groupedEvents).length;
  if (recurringSeriesCount > 0) {
    console.log(`Found ${recurringSeriesCount} recurring meeting series`);
    
    // For each recurring series, ensure we only process the next occurrence
    Object.values(groupedEvents).forEach(seriesEvents => {
      // Sort by start time (earliest first)
      seriesEvents.sort((a, b) => {
        const aTime = new Date(a.start.dateTime || a.start.date).getTime();
        const bTime = new Date(b.start.dateTime || b.start.date).getTime();
        return aTime - bTime;
      });
      
      // Add only the next occurrence to our non-recurring list
      if (seriesEvents.length > 0) {
        nonRecurringEvents.push(seriesEvents[0]);
      }
    });
  }
  
  // Store all the processed events (next occurrence of recurring + non-recurring) 
  chrome.storage.local.set({ upcomingEvents: nonRecurringEvents });
  console.log(`Stored ${nonRecurringEvents.length} events (after recurring event processing)`);
  
  // Set alarms for events that are coming up soon
  const now = new Date();
  
  nonRecurringEvents.forEach(event => {
    const startTime = new Date(event.start.dateTime || event.start.date);
    const minutesUntilEvent = (startTime - now) / (1000 * 60);
    
    // If event is within call trigger threshold and doesn't have an alarm yet
    if (minutesUntilEvent <= CONFIG.CALL_TRIGGER_THRESHOLD) {
      const alarmName = `eventReminder_${event.id}`;
      
      // Check if we already have an alarm for this
      chrome.alarms.get(alarmName, alarm => {
        if (!alarm) {
          // Calculate when to trigger the alarm (30 seconds before event)
          const alarmTime = new Date(startTime);
          alarmTime.setSeconds(alarmTime.getSeconds() - CONFIG.ALARM_OFFSET);
          
          // Only set alarm if it's in the future
          if (alarmTime > now) {
            console.log(`Setting alarm for "${event.summary || 'Unnamed meeting'}" at ${alarmTime.toLocaleTimeString()}`);
            chrome.alarms.create(alarmName, { when: alarmTime.getTime() });
          } else {
            // Event is happening now or very soon, trigger immediately
            console.log(`Event "${event.summary || 'Unnamed meeting'}" starting now, triggering immediately`);
            triggerCallOverlay(event.id);
          }
        }
      });
    }
  });
}

// Trigger the call overlay for a specific event
function triggerCallOverlay(eventId) {
  try {
    chrome.storage.local.get(['upcomingEvents', 'processedEvents', 'settings'], data => {
      try {
        const event = data.upcomingEvents?.find(e => e.id === eventId);
        const processedEvents = data.processedEvents || [];
        const settings = data.settings || { autoJoin: false, ringtone: 'default' };
        
        // Make sure event exists and hasn't been processed yet
        if (event && !processedEvents.includes(eventId)) {
          console.log(`Triggering call overlay for event: ${event.summary || 'Unnamed meeting'}`);
          
          // Add to processed events to prevent duplicate notifications
          processedEvents.push(eventId);
          chrome.storage.local.set({ processedEvents });
          
          // Extract meeting details
          const meetingDetails = {
            id: event.id,
            title: event.summary || 'Unnamed meeting',
            startTime: event.start.dateTime || event.start.date,
            meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri,
            attendees: event.attendees || [],
            location: event.location || '',
            description: event.description || '',
            settings: settings
          };
          
          // Ensure we have a valid meeting link
          if (!meetingDetails.meetLink) {
            console.warn('Event has no valid meeting link:', eventId);
            meetingDetails.meetLink = ''; // Provide empty string as fallback
          }
          
          // Open call overlay window
          chrome.windows.create({
            url: `call-overlay/overlay.html?meeting=${encodeURIComponent(JSON.stringify(meetingDetails))}`,
            type: 'popup',
            width: 500,
            height: 700
          }, (window) => {
            if (chrome.runtime.lastError) {
              console.error('Failed to open call overlay window:', chrome.runtime.lastError);
              // Make sure notification is shown as fallback
              showMeetingNotification(eventId, meetingDetails);
            } else {
              console.log('Call overlay window opened successfully');
            }
          });
          
          // Always show notification even if window opens (belt and suspenders approach)
          showMeetingNotification(eventId, meetingDetails);
        } else if (!event) {
          console.warn(`Cannot find event details for ID: ${eventId}`);
        } else {
          console.log(`Event ${eventId} has already been processed, ignoring`);
        }
      } catch (overlayError) {
        console.error('Error in triggerCallOverlay:', overlayError);
        logError(overlayError, 'call_overlay');
      }
    });
  } catch (error) {
    console.error('Critical error in triggerCallOverlay:', error);
    logError(error, 'call_overlay_critical');
  }
}

// Helper function to show meeting notification
function showMeetingNotification(eventId, meetingDetails) {
  try {
    chrome.notifications.create(`meeting_${eventId}`, {
      type: 'basic',
      iconUrl: '/assets/icons/icon128.png',
      title: 'Incoming Meeting',
      message: meetingDetails.title,
      buttons: [
        { title: 'Join' },
        { title: 'Dismiss' }
      ],
      priority: 2
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('Notification creation failed:', chrome.runtime.lastError);
      }
    });
  } catch (notificationError) {
    console.error('Failed to create notification:', notificationError);
    logError(notificationError, 'notification_create');
  }
}

// This function is now deprecated as we're using authService
// Kept for reference in case we need to fallback to the old implementation
async function _legacyGetAuthToken(interactive = false) {
  return new Promise((resolve) => {
    console.log(`[LEGACY] Getting auth token (interactive: ${interactive})`);
    
    // Check for stored token in local storage first
    chrome.storage.local.get(['oauth_token', 'token_expiry'], (data) => {
      if (chrome.runtime.lastError) {
        console.error('Error accessing storage:', chrome.runtime.lastError);
        resolve(null);
        return;
      }
      
      const token = data.oauth_token;
      const expiry = data.token_expiry;
      
      // If we have a token and it's not expired
      if (token && expiry && Date.now() < expiry) {
        console.log('Using stored token from storage');
        resolve(token);
        return;
      }
      
      // No valid token in storage
      if (!interactive) {
        console.log('No valid token found in storage and interactive auth not requested');
        resolve(null);
        return;
      }
      
      // If interactive is requested, let the popup handle the authentication flow
      // via WebAuthFlow since getAuthToken has issues
      console.log('Interactive auth requested - deferring to popup WebAuthFlow');
      resolve(null);
    });
  });
}

// Initialize on install or update
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    // First time installation
    chrome.storage.local.set({ 
      firstRun: true,
      processedEvents: [],
      settings: {
        notificationTiming: 5, // minutes before meeting
        autoJoin: false,
        ringtone: 'default'
      }
    });
  }
  
  initialize();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(initialize);

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getUpcomingMeetings') {
    chrome.storage.local.get('upcomingEvents', data => {
      sendResponse({ meetings: data.upcomingEvents || [] });
    });
    return true; // Required for async sendResponse
  } 
  else if (message.action === 'authenticationUpdated') {
    console.log('Authentication updated, refreshing...');
    // Re-initialize authService and re-check auth status
    authService.initialize().then(() => checkAuthStatus());
    return true;
  }
});
