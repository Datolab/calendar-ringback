// Google Calendar Callback Extension - Background Service Worker
// Responsible for calendar monitoring and triggering call notifications

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
  
  // Check for authentication status
  checkAuthStatus();
  
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
    
    // First try to get token non-interactively
    let token = await getAuthToken(interactive);
    
    // If no token and we're allowed to be interactive, try interactive auth
    if (!token && interactive) {
      console.log('No token found, trying interactive authentication...');
      token = await getAuthToken(true);
    }
    
    isAuthenticated = !!token;
    
    if (isAuthenticated) {
      console.log('User is authenticated, starting calendar monitoring');
      fetchUpcomingEvents();
      
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

// Fetch upcoming calendar events
async function fetchUpcomingEvents() {
  try {
    const token = await getAuthToken();
    if (!token) return;
    
    // Calculate time range for API query
    const now = new Date();
    const timeMin = now.toISOString();
    
    const future = new Date(now);
    future.setMinutes(now.getMinutes() + CONFIG.UPCOMING_EVENT_THRESHOLD);
    const timeMax = future.toISOString();
    
    // TODO: Implement actual API call to Google Calendar
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, 
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    const data = await response.json();
    
    if (!data.items) {
      console.log('No upcoming events found');
      return;
    }
    
    // Filter for events with Google Meet links
    const eventsWithMeet = data.items.filter(event => {
      // Check if user has accepted the event
      const selfAttendee = event.attendees?.find(attendee => attendee.self);
      const hasAccepted = !selfAttendee || selfAttendee.responseStatus === 'accepted';
      
      // Check for Google Meet link
      const hasMeetLink = event.hangoutLink || 
                         (event.conferenceData?.conferenceId && 
                          event.conferenceData?.conferenceSolution?.name === 'Google Meet');
                          
      return hasAccepted && hasMeetLink;
    });
    
    processUpcomingEvents(eventsWithMeet);
    
  } catch (error) {
    console.error('Error fetching calendar events:', error);
  }
}

// Process the list of upcoming events
function processUpcomingEvents(events) {
  // Store the events
  chrome.storage.local.set({ upcomingEvents: events });
  
  // Set alarms for events that are coming up soon
  const now = new Date();
  
  events.forEach(event => {
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
            chrome.alarms.create(alarmName, { when: alarmTime.getTime() });
          } else {
            // Event is happening now or very soon, trigger immediately
            triggerCallOverlay(event.id);
          }
        }
      });
    }
  });
}

// Trigger the call overlay for a specific event
function triggerCallOverlay(eventId) {
  chrome.storage.local.get(['upcomingEvents', 'processedEvents'], data => {
    const event = data.upcomingEvents?.find(e => e.id === eventId);
    const processedEvents = data.processedEvents || [];
    
    // Make sure event exists and hasn't been processed yet
    if (event && !processedEvents.includes(eventId)) {
      // Add to processed events to prevent duplicate notifications
      processedEvents.push(eventId);
      chrome.storage.local.set({ processedEvents });
      
      // Extract meeting details
      const meetingDetails = {
        id: event.id,
        title: event.summary || 'Unnamed meeting',
        startTime: event.start.dateTime || event.start.date,
        meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri,
        attendees: event.attendees || []
      };
      
      // Open call overlay window
      chrome.windows.create({
        url: `call-overlay/overlay.html?meeting=${encodeURIComponent(JSON.stringify(meetingDetails))}`,
        type: 'popup',
        width: 500,
        height: 700
      });
      
      // Also create a notification as fallback
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
      });
    }
  });
}

// Helper function to get authentication token
async function getAuthToken(interactive = false) {
  return new Promise((resolve) => {
    console.log(`Getting auth token (interactive: ${interactive})`);
    
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
    // Re-check auth and fetch calendar events
    checkAuthStatus();
    return true;
  }
});
