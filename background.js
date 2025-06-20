// Google Calendar Callback Extension - Background Service Worker
// Responsible for calendar monitoring and triggering call notifications

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
async function checkAuthStatus() {
  try {
    const token = await getAuthToken();
    isAuthenticated = !!token;
    
    if (isAuthenticated) {
      console.log('User is authenticated, starting calendar monitoring');
      fetchUpcomingEvents();
    } else {
      console.log('User is not authenticated, prompting for auth');
      // Will prompt user for authentication in popup
    }
  } catch (error) {
    console.error('Error checking authentication status:', error);
  }
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
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, token => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
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
