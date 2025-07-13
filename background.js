// Google Calendar Callback Extension - Background Service Worker
// Responsible for calendar monitoring and triggering call notifications

// Import services
import errorTracker from './utils/error-tracking.js';

// Import the AuthService singleton for token management
import authService from './popup/services/auth.service.js';

// Service worker registration error handling
if (typeof self !== 'undefined') {
  self.addEventListener('error', (event) => {
    console.error('Service Worker Error:', event.error || event.message || 'Unknown error');
    errorTracker.captureException(event.error || new Error(event.message || 'Service Worker Error'));
  });

  self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled Promise Rejection in Service Worker:', event.reason);
    errorTracker.captureException(event.reason || new Error('Unhandled Promise Rejection'));
  });
}

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

// Constants
const CALENDAR_ALARM_NAME = 'calendarPolling'; // Alarm name for polling calendar
const CALENDAR_POLLING_INTERVAL = 5; // Minutes between calendar polls
const EVENT_TRIGGER_THRESHOLD = 5; // Minutes before event to trigger alarm
const MAX_PAGES = 3; // Maximum number of calendar API result pages to process
const MAX_EVENTS_TO_LOG = 5; // Maximum number of events to log details for
const POPUP_STATUS_INTERVAL = 2; // Seconds between status updates to popup
const DEBUG = true; // Enable debug logging (can be toggled in settings)

// Global variables
let popupUpdateInterval = null; // Interval for sending status updates to popup

// State variables
let isPolling = false;
let lastPollTime = null;
let upcomingMeetings = [];
let lastError = null;
let monitoringState = 'inactive'; // 'inactive' | 'starting' | 'active'
let isAuthenticated = false; // Track authentication state
let popupPort = null; // For direct port communication with popup
const MONITORING_STORAGE_KEY = 'monitoringState';
const KEEP_ALIVE_INTERVAL = 25000; // 25 seconds (less than 30s Chrome service worker timeout)

// Maintain a single instance of auth state for the entire extension
let authState = {
  isAuthenticated: false,
  userInfo: null,
  token: null,
  tokenExpiry: null
};

// Track the current token refresh promise to prevent duplicate refreshes
let currentTokenRefresh = null;

/**
 * Safely refresh the authentication token
 * @param {boolean} interactive - Whether to show the auth UI if needed
 * @returns {Promise<{token: string, userInfo: object}>}
 */
async function refreshTokenSafely(interactive = false) {
  // If we're already refreshing, return the existing promise
  if (currentTokenRefresh) {
    console.log('[Background] Token refresh already in progress, returning existing promise');
    return currentTokenRefresh;
  }

  try {
    console.log(`[Background] Starting safe token refresh (interactive: ${interactive})`);
    
    // Create a promise that will resolve when the refresh is complete
    currentTokenRefresh = (async () => {
      try {
        // Refresh the token using the auth service
        const result = await authService.refreshToken(interactive);
        
        if (result && result.token) {
          // Update our local state with the new token
          await updateAuthState({
            token: result.token,
            tokenExpiry: result.expiry,
            userInfo: result.userInfo || authState.userInfo,
            isAuthenticated: true
          });
          
          return {
            token: result.token,
            userInfo: result.userInfo || authState.userInfo
          };
        } else {
          throw new Error('No token received from refresh');
        }
      } finally {
        // Always clear the current refresh when done
        currentTokenRefresh = null;
      }
    })();

    return await currentTokenRefresh;
  } catch (error) {
    console.error('[Background] Error in safe token refresh:', error);
    
    // If the error is an auth error, clear the auth state
    if (error.message.includes('auth') || error.message.includes('token')) {
      console.log('[Background] Auth error, clearing auth state');
      await updateAuthState({
        token: null,
        tokenExpiry: null,
        userInfo: null,
        isAuthenticated: false
      });
    }
    
    throw error;
  }
}

// Update the auth state and notify all connected ports
async function updateAuthState(newState) {
  console.log('[Background] Updating auth state:', {
    ...newState,
    token: newState.token ? '[REDACTED]' : null,
    hasToken: !!newState.token,
    tokenExpiry: newState.tokenExpiry ? new Date(newState.tokenExpiry).toISOString() : null
  });
  
  // Merge new state
  const updatedState = { 
    ...authState, 
    ...newState,
    isAuthenticated: !!(newState.token && 
      (!newState.tokenExpiry || new Date(newState.tokenExpiry) > new Date(Date.now() + 60000))) // Add 1 minute buffer
  };
  
  // Update the global isAuthenticated variable
  isAuthenticated = updatedState.isAuthenticated;
  
  // Only update if something actually changed
  const stateChanged = 
    authState.token !== updatedState.token ||
    authState.tokenExpiry !== updatedState.tokenExpiry ||
    authState.isAuthenticated !== updatedState.isAuthenticated;
  
  if (!stateChanged) {
    console.log('[Background] Auth state unchanged, skipping update');
    return;
  }
  
  authState = updatedState;
  isAuthenticated = authState.isAuthenticated;
  
  // Save to storage for persistence
  const stateToSave = {
    token: authState.token,
    tokenExpiry: authState.tokenExpiry,
    userInfo: authState.userInfo
  };
  
  try {
    // Save to local storage
    await chrome.storage.local.set({ 
      auth_state: stateToSave,
      lastAuthUpdate: Date.now()
    });
    
    // Also save to sync storage if available
    if (chrome.storage.sync) {
      try {
        await chrome.storage.sync.set({ 
          auth_state: stateToSave,
          lastAuthUpdate: Date.now()
        });
        console.log('[Background] Auth state saved to sync storage');
      } catch (syncError) {
        console.warn('[Background] Could not save to sync storage:', syncError);
      }
    }
    
    console.log('[Background] Auth state saved to storage');
    
    // Notify all connected ports about the auth state change
    sendStatusUpdateToPopup();
    
  } catch (error) {
    console.error('[Background] Error saving auth state:', error);
    errorTracker.captureException(error, { 
      context: 'save_auth_state',
      hasToken: !!authState.token,
      hasUserInfo: !!authState.userInfo
    });
  }
  
  // Notify all connected ports
  sendStatusUpdateToPopup();
  
  // If we just signed out, clear any sensitive data
  if (newState.token === null) {
    console.log('[Background] Auth state cleared, resetting sensitive data');
    upcomingMeetings = [];
    lastPollTime = null;
  }
  
  return authState;
}

// Initialize auth state from storage
async function initializeAuthState() {
  try {
    // Try to load from sync storage first (persists across devices)
    let data = {};
    try {
      if (chrome.storage.sync) {
        data = await chrome.storage.sync.get('auth_state');
        console.log('[Background] Loaded auth state from sync storage:', data.auth_state ? 'found' : 'not found');
      }
    } catch (syncError) {
      console.warn('[Background] Could not load from sync storage:', syncError);
    }
    
    // If nothing in sync storage, try local storage
    if (!data.auth_state) {
      data = await chrome.storage.local.get('auth_state');
      console.log('[Background] Loaded auth state from local storage:', data.auth_state ? 'found' : 'not found');
    }
    
    if (data.auth_state) {
      const isValid = data.auth_state.token && 
                     data.auth_state.tokenExpiry > Date.now();
      
      authState = {
        token: data.auth_state.token || null,
        tokenExpiry: data.auth_state.tokenExpiry || null,
        userInfo: data.auth_state.userInfo || null,
        isAuthenticated: isValid
      };
      
      isAuthenticated = authState.isAuthenticated;
      
      // If token is invalid, clear it
      if (!isValid && data.auth_state.token) {
        console.log('[Background] Token expired, clearing auth state');
        await Promise.all([
          chrome.storage.local.remove('auth_state'),
          chrome.storage.sync?.remove('auth_state')
        ]);
        authState = { isAuthenticated: false, token: null, tokenExpiry: null, userInfo: null };
        isAuthenticated = false;
      } else if (isValid) {
        // If we have a valid token, ensure auth service is in sync
        try {
          console.log('[Background] Syncing auth service with stored state');
          await authService.login(false); // Non-interactive login
        } catch (error) {
          console.warn('[Background] Failed to sync auth service:', error);
        }
      }
    } else {
      console.log('[Background] No auth state found in any storage');
      authState = { isAuthenticated: false, token: null, tokenExpiry: null, userInfo: null };
      isAuthenticated = false;
    }
    
    console.log('[Background] Initialized auth state:', {
      isAuthenticated,
      hasToken: !!authState.token,
      tokenExpiry: authState.tokenExpiry ? new Date(authState.tokenExpiry).toISOString() : null
    });
    
    return authState;
  } catch (error) {
    console.error('Error initializing auth state:', error);
    errorTracker.captureException(error, { context: 'initialize_auth_state' });
    return { isAuthenticated: false, token: null, tokenExpiry: null, userInfo: null };
  }
}

// Set up port connection from popup
function setupPortConnection(port) {
  if (port.name === 'popup') {
    // Store the port for later use
    popupPort = port;
    
    // Set up message handler
    port.onMessage.addListener(handlePopupMessage);
    
    // Handle port disconnection
    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected');
      if (popupPort === port) {
        popupPort = null;
      }
    });
    
    console.log('Connected to popup');
  }
}

// Initialize the extension
async function initialize() {
  try {
    console.log('Initializing extension...');
    
    // Set up port connection listener
    chrome.runtime.onConnect.addListener(setupPortConnection);
    
    // Initialize auth state
    await initializeAuthState();
    
    // Restore monitoring state from storage
    const storedState = await chrome.storage.local.get(MONITORING_STORAGE_KEY);
    if (storedState[MONITORING_STORAGE_KEY]) {
      monitoringState = storedState[MONITORING_STORAGE_KEY].state || 'inactive';
      lastPollTime = storedState[MONITORING_STORAGE_KEY].lastPollTime 
        ? new Date(storedState[MONITORING_STORAGE_KEY].lastPollTime) 
        : null;
    }
    
    // Set up the polling alarm
    await setupPollingAlarm();
    
    // Set up keep-alive mechanism
    setupKeepAlive();
    
    // Initial poll if authenticated
    const authState = await initializeAuthState();
    if (authState.isAuthenticated) {
      await pollCalendar();
    } else {
      // Still send status update to update UI
      sendStatusUpdateToPopup();
    }
    
    console.log('Extension initialized with monitoring state:', monitoringState);
  } catch (error) {
    console.error('Failed to initialize extension:', error);
    logError(error, 'initialization');
  }
}

// Set up keep-alive mechanism to prevent service worker from going inactive
function setupKeepAlive() {
  // Keep the service worker alive with periodic checks
  const keepAlive = () => {
    if (monitoringState === 'active') {
      // Just update the timestamp to show we're still alive
      updateMonitoringState(monitoringState);
    }
  };
  
  // Run more frequently than the service worker timeout (30s)
  setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
  
  // Also keep alive on visibility changes
  chrome.runtime.onStartup.addListener(keepAlive);
  chrome.windows.onFocusChanged.addListener(keepAlive);
  chrome.tabs.onActivated.addListener(keepAlive);
  chrome.tabs.onUpdated.addListener(keepAlive);
}

// Update monitoring state and persist it
async function updateMonitoringState(newState, additionalData = {}) {
  if (newState !== monitoringState || additionalData.forceUpdate) {
    monitoringState = newState;
    
    // Persist the state
    await chrome.storage.local.set({
      [MONITORING_STORAGE_KEY]: {
        state: monitoringState,
        lastUpdated: new Date().toISOString(),
        lastPollTime: lastPollTime ? lastPollTime.toISOString() : null,
        ...additionalData
      }
    });
    
    console.log(`Monitoring state updated to: ${monitoringState}`);
  }
  
  // Always send status update when state changes
  sendStatusUpdateToPopup();
}

// Check OAuth authentication status
async function checkAuthStatus(interactive = false) {
  try {
    console.log(`[Background] Checking auth status (interactive: ${interactive})`);
    
    // First check our local auth state
    const currentState = await initializeAuthState();
    
    // Check if we have a valid token that's not about to expire soon (within 5 minutes)
    const tokenExpiresSoon = currentState.tokenExpiry && 
                           (currentState.tokenExpiry - Date.now()) < 300000; // 5 minutes
    
    // If we have a valid token that's not expiring soon, we're good
    if (currentState.token && !tokenExpiresSoon) {
      console.log('[Background] Using existing valid token');
      isAuthenticated = true;
      return true;
    }
    
    // If we have a token but it's expiring soon, try to refresh it
    if (currentState.token && tokenExpiresSoon) {
      console.log('[Background] Token expiring soon, attempting to refresh...');
      try {
        const { token, userInfo } = await refreshTokenSafely(interactive);
        if (token) {
          console.log('[Background] Token refreshed successfully');
          isAuthenticated = true;
          return true;
        }
      } catch (error) {
        console.error('[Background] Error refreshing token:', error);
        // Continue to interactive auth if refresh fails
      }
    }
    
    // If we get here, we need to authenticate
    console.log('[Background] No valid token found, authentication required');
    isAuthenticated = false;
    
    // If interactive is true, try to authenticate now
    if (interactive) {
      console.log('[Background] Starting interactive authentication...');
      try {
        const { token, userInfo } = await refreshTokenSafely(true);
        if (token) {
          console.log('[Background] Interactive authentication successful');
          isAuthenticated = true;
          return true;
        }
      } catch (error) {
        console.error('[Background] Interactive authentication failed:', error);
        // Continue to return false
      }
    }
    
    // If not authenticated and interactive mode is allowed, try interactive auth
    if (interactive) {
      console.log('Not authenticated, trying interactive authentication...');
      try {
        // Use authService for the actual authentication flow
        await authService.login(interactive);
        
        // Update our local auth state with the new token
        const token = await authService.getToken();
        const userInfo = await authService.getUserInfo();
        
        await updateAuthState({
          token: token,
          tokenExpiry: Date.now() + (60 * 60 * 1000), // 1 hour from now
          userInfo: userInfo,
          isAuthenticated: true
        });
        
        isAuthenticated = true;
      } catch (authError) {
        console.error('Interactive authentication failed:', authError);
        isAuthenticated = false;
        await updateAuthState({
          token: null,
          tokenExpiry: null,
          userInfo: null,
          isAuthenticated: false
        });
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
      sendMessageToPopup({ action: 'authUpdated', authenticated: true }, true);
    } else if (interactive) {
      console.log('Interactive authentication failed');
      // Notify popup that authentication failed
      sendMessageToPopup({ 
        action: 'authUpdated', 
        authenticated: false,
        error: 'Failed to authenticate. Please try again.'
      }, true);
    } else {
      console.log('User is not authenticated');
      // Notify popup that we need authentication
      sendMessageToPopup({ 
        action: 'authNeeded',
        message: 'Please sign in to continue.'
      }, true);
    }
    
    return isAuthenticated;
  } catch (error) {
    console.error('Error checking authentication status:', error);
    logError(error, 'auth_check');
    // Notify popup about the error
    sendMessageToPopup({
      action: 'authError',
      error: error.message || 'Unknown authentication error'
    }, true);
    return false;
  }
}

/**
 * Send a status update to the popup if it's open
 * @param {object} message - The message to send
 * @param {boolean} forceSend - Whether to force sending even if not connected
 */
/**
 * Handle messages from the popup through port connection
 * @param {Object} message - Message from popup
 * @param {MessagePort} port - The port the message was received on (optional)
 */
function handlePopupMessage(message, port) {
  try {
    console.log('Background received message from popup:', message);
    
    // Handle the message based on action
    switch (message.action) {
      case 'getStatusUpdate':
        sendStatusUpdateToPopup();
        break;
        
      case 'refreshMeetings':
        pollCalendar();
        break;
        
      case 'checkAuth':
        checkAuthStatus();
        break;
        
      case 'signIn':
        signIn();
        break;
        
      case 'signOut':
        signOut();
        break;
        
      default:
        console.log('Unknown message action:', message.action);
    }
  } catch (error) {
    console.error('Error handling popup message:', error);
    logError(error, 'popup_message_handler');
  }
}

/**
 * Send a message to the popup if it's connected
 * @param {Object} message - The message to send
 * @param {boolean} forceSend - Whether to try alternative methods if port is not available
 * @returns {boolean} Whether the message was sent successfully
 */
function sendMessageToPopup(message, forceSend = false) {
  try {
    let messageSent = false;
    
    // Try using the port connection first if available
    if (popupPort) {
      try {
        popupPort.postMessage(message);
        messageSent = true;
      } catch (portError) {
        console.log('Port connection error, clearing reference:', portError.message);
        popupPort = null;
      }
    }
    
    // If port message failed and forceSend is true, try runtime messaging
    if (!messageSent && forceSend) {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            console.debug('Runtime message not delivered (popup likely closed):', 
                        chrome.runtime.lastError.message);
          }
        });
        messageSent = true;
      } catch (runtimeError) {
        console.error('Runtime message failed:', runtimeError);
      }
    }
    
    return messageSent;
  } catch (error) {
    console.error('Failed to send message to popup:', error);
    logError(error, 'popup_messaging');
    return false;
  }
}

/**
 * Sends a comprehensive status update to the popup
 * Includes authentication status, upcoming meetings, and last poll time
 */
async function sendStatusUpdateToPopup() {
  try {
    // Check authentication status
    const isAuthenticated = await authService.isAuthenticated();
    
    // Get user info if authenticated
    let userInfo = null;
    if (isAuthenticated) {
      try {
        userInfo = await authService.getUserInfo(true); // silent fail
      } catch (userInfoError) {
        console.debug('Could not fetch user info:', userInfoError.message);
      }
    }
    
    // Prepare status message
    const statusMessage = {
      action: 'statusUpdate',
      data: {
        authenticated: isAuthenticated,
        userInfo: userInfo,
        lastPollTime: lastPollTime ? lastPollTime.toISOString() : null,
        lastError: lastError,
        upcomingMeetings: upcomingMeetings,
        isPolling: isPolling,
        monitoringState: monitoringState, // Add monitoring state
        pollInterval: CALENDAR_POLLING_INTERVAL,
        triggerThreshold: EVENT_TRIGGER_THRESHOLD,
        timestamp: new Date().toISOString()
      }
    };
    
    // Send the status update
    sendMessageToPopup(statusMessage, true); // Use force send option since this is important
  } catch (error) {
    console.error('Error sending status update to popup:', error);
    logError(error, 'status_update');
    // No need to re-throw; this is a background task
  }
}

// Handle alarms
async function handleAlarm(alarm) {
  if (alarm.name === CALENDAR_ALARM_NAME) {
    if (isAuthenticated) {
      await fetchUpcomingEvents();
    }
  } else if (alarm.name.startsWith('eventReminder_')) {
    const eventId = alarm.name.replace('eventReminder_', '');
    triggerCallOverlay(eventId);
  }
}

// Helper function to determine if an error is retryable
function isRetryableError(statusCode) {
  // 5xx errors are server errors and can be retried
  // 429 is too many requests (rate limiting)
  // 408 is request timeout
  return statusCode >= 500 || statusCode === 429 || statusCode === 408;
}

// Helper function to fetch with retry logic
async function fetchWithRetry(url, token, maxRetries = 2) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      // If successful, return the response
      if (response.ok) {
        return response;
      }
      
      // If we get a 401, we need to refresh the token
      if (response.status === 401) {
        throw new Error('token_expired');
      }
      
      // For other errors, check if we should retry
      if (!isRetryableError(response.status) || attempt === maxRetries) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
      }
      
      console.log(`Attempt ${attempt + 1} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
      
    } catch (error) {
      lastError = error;
      if (error.message === 'token_expired' || attempt === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  
  throw lastError || new Error('Unknown error in fetchWithRetry');
}

// Fetch upcoming calendar events with pagination support
async function fetchUpcomingEvents() {
  let allEvents = [];
  let nextPageToken = null;
  let pageCount = 0;
  const MAX_PAGES = 5; // Safety limit to prevent infinite loops
  let token;
  
  try {
    // Get a fresh token
    const authResult = await refreshTokenSafely();
    if (!authResult || !authResult.token) {
      throw new Error('No authentication token available');
    }
    token = authResult.token;
    
    // Calculate time range for API query (next 24 hours)
    const now = new Date();
    const timeMin = now.toISOString();
    const future = new Date(now);
    future.setDate(now.getDate() + 1); // Look ahead 24 hours
    const timeMax = future.toISOString();
    
    console.log(`Fetching calendar events from ${timeMin} to ${timeMax}`);
    
    // Process pages until we have all events or hit the max page limit
    do {
      // Build URL with pagination token if we have one
      let url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
                `timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
                `&singleEvents=true&orderBy=startTime&maxResults=100`;
      
      if (nextPageToken) {
        url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
        console.log(`Fetching additional page ${pageCount + 1} of calendar events`);
      }
      
      try {
        // Make API call with retry logic
        const response = await fetchWithRetry(url, token);
        const data = await response.json();
        
        pageCount++;
        
        // Process the current page of results
        if (data.items && data.items.length > 0) {
          allEvents = allEvents.concat(data.items);
          console.log(`Added ${data.items.length} events from page ${pageCount}, total: ${allEvents.length}`);
        }
        
        // Get the next page token if available
        nextPageToken = data.nextPageToken || null;
        
      } catch (error) {
        console.error('Error fetching calendar events page:', error);
        
        // If we've already retried multiple times, give up
        if (pageCount >= MAX_PAGES) {
          throw new Error(`Failed to fetch calendar events after ${pageCount} attempts: ${error.message}`);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } while (nextPageToken && pageCount < MAX_PAGES);
    
    if (pageCount >= MAX_PAGES && nextPageToken) {
      console.warn(`Reached maximum page limit (${MAX_PAGES}). Some events may not be processed.`);
    }
    
    // If we didn't find any events at all
    if (allEvents.length === 0) {
      console.log('No upcoming events found');
      return [];
    }
    
    // Process all the events we found
    console.log(`Successfully fetched ${allEvents.length} calendar events`);
    
    // Filter for events with Google Meet links
    const eventsWithMeet = allEvents.filter(event => {
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
    await processUpcomingEvents(eventsWithMeet);
    return eventsWithMeet;
    
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    logError(error, 'calendar_fetch');
    
    // Handle specific error types
    if (error.message && error.message.includes('quota')) {
      console.warn('Calendar API quota exceeded. Will retry on next polling cycle.');
      // Store error state for UI feedback
      await chrome.storage.local.set({
        calendarApiState: {
          lastError: 'quota_exceeded',
          timestamp: Date.now(),
          message: 'Calendar API quota exceeded. Will retry automatically.'
        }
      });
    } else if (error.message && (error.message.includes('network') || error.message.includes('failed'))) {
      console.warn('Network error when fetching events. Will retry on next polling cycle.');
      // Store error state for UI feedback
      await chrome.storage.local.set({
        calendarApiState: {
          lastError: 'network_error',
          timestamp: Date.now(),
          message: 'Network error. Will retry automatically.'
        }
      });
    } else if (error.message && (error.message.includes('token') || error.message.includes('auth'))) {
      console.warn('Authentication error. User may need to sign in again.');
      await chrome.storage.local.set({
        calendarApiState: {
          lastError: 'auth_error',
          timestamp: Date.now(),
          message: 'Authentication required. Please sign in again.'
        }
      });
      // Sign out to clear any invalid auth state
      await authService.signOut();
    } else {
      // Generic error handling
      await chrome.storage.local.set({
        calendarApiState: {
          lastError: 'unknown_error',
          timestamp: Date.now(),
          message: error.message || 'Unknown error fetching calendar data.'
        }
      });
    }
    
    // Re-throw the error to be handled by the caller
    throw error;
  } finally {
    // Always update the last fetch timestamp regardless of success/failure
    try {
      await chrome.storage.local.set({
        lastCalendarFetch: Date.now()
      });
    } catch (storageError) {
      console.error('Error updating last fetch time:', storageError);
    }
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
    if (minutesUntilEvent <= EVENT_TRIGGER_THRESHOLD) {
      const alarmName = `eventReminder_${event.id}`;
      
      // Check if we already have an alarm for this
      chrome.alarms.get(alarmName, alarm => {
        if (!alarm) {
          // Calculate when to trigger the alarm (30 seconds before event)
          const alarmTime = new Date(startTime);
          alarmTime.setSeconds(alarmTime.getSeconds() - 30);
          
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

/**
 * Set up the polling alarm for calendar updates
 */
async function setupPollingAlarm() {
  try {
    // Clear any existing alarms to prevent duplicates
    await chrome.alarms.clear(CALENDAR_ALARM_NAME);
    
    // Create a new alarm for polling
    await chrome.alarms.create(CALENDAR_ALARM_NAME, {
      periodInMinutes: CALENDAR_POLLING_INTERVAL
    });
    
    console.log(`Calendar polling alarm set to run every ${CALENDAR_POLLING_INTERVAL} minutes`);
  } catch (error) {
    console.error('Failed to set up polling alarm:', error);
    errorTracker.captureException(error, { context: 'setup_polling_alarm' });
    throw error;
  }
}

/**
 * Poll the calendar for upcoming events
 * This is called both by the polling alarm and when manually refreshing from the popup
 */
async function pollCalendar() {
  // Skip if already polling
  if (isPolling) {
    console.log('Calendar polling already in progress, skipping this request');
    return;
  }
  
  isPolling = true;
  
  try {
    console.log('Starting calendar polling...');
    
    // Update monitoring state to 'starting'
    await updateMonitoringState('starting');
    
    // Small delay to ensure UI can show the starting state
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Fetch upcoming events
    await fetchUpcomingEvents();
    
    // Update state and timestamps
    lastPollTime = new Date();
    lastError = null;
    
    // Update monitoring state to 'active' with the new poll time
    await updateMonitoringState('active', {
      lastPollTime: lastPollTime.toISOString()
    });
    
    console.log('Calendar polling completed successfully');
    
  } catch (error) {
    console.error('Error polling calendar:', error);
    lastError = error.message;
    await updateMonitoringState('inactive', { error: error.message });
    
  } finally {
    try {
      // Ensure we always have a final state
      if (monitoringState === 'starting') {
        await updateMonitoringState('active');
      }
      
      // Send final status update
      sendStatusUpdateToPopup();
    } finally {
      isPolling = false;
    }
  }
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener(handleAlarm);

// Set up connection management for popup
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'popup') {
    console.log('Popup connected');
    
    // Store the port for later use
    popupPort = port;
    
    // Send an immediate status update
    sendStatusUpdateToPopup();
    
    // Set up periodic status updates while popup is open
    if (popupUpdateInterval) {
      clearInterval(popupUpdateInterval);
    }
    
    popupUpdateInterval = setInterval(() => {
      if (popupPort) {
        sendStatusUpdateToPopup();
      } else {
        // Clear interval if popup disconnected
        clearInterval(popupUpdateInterval);
        popupUpdateInterval = null;
      }
    }, POPUP_STATUS_INTERVAL * 1000);
    
    // Handle popup disconnection
    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected');
      popupPort = null;
      
      // Clean up interval
      if (popupUpdateInterval) {
        clearInterval(popupUpdateInterval);
        popupUpdateInterval = null;
      }
    });
  }
});

// Listen for messages from the popup or other parts of the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle the message and send response
  const respond = (success, data = {}) => {
    if (chrome.runtime.lastError) {
      console.error('Error sending response:', chrome.runtime.lastError);
      return;
    }
    
    const response = {
      success,
      ...data,
      timestamp: new Date().toISOString()
    };
    
    // Add auth state to all responses if not explicitly set
    if (!data.authState) {
      response.authState = {
        isAuthenticated: authState.isAuthenticated,
        userInfo: authState.userInfo,
        hasToken: !!authState.token
      };
    }
    
    sendResponse(response);
  };
  
  // Process message by action
  try {
    switch (message.action) {
      case 'getStatusUpdate':
        // Return current status data
        authService.isAuthenticated().then(authenticated => {
          respond(true, {
            data: {
              authenticated,
              lastPollTime: lastPollTime ? lastPollTime.toISOString() : null,
              lastError,
              upcomingMeetings,
              isPolling,
              pollInterval: CALENDAR_POLLING_INTERVAL,
              triggerThreshold: EVENT_TRIGGER_THRESHOLD
            }
          });
        }).catch(error => {
          console.error('Error checking auth for status update:', error);
          respond(false, { error: error.message });
        });
        return true; // Keep channel open for async response
        
      case 'getUpcomingMeetings':
        // Return meetings directly from storage to ensure freshness
        chrome.storage.local.get('upcomingEvents', data => {
          respond(true, { meetings: data.upcomingEvents || [] });
        });
        return true; // Required for async sendResponse
        
      case 'getAuthStatus':
        // Return the current auth state
        respond(true, { 
          isAuthenticated: authState.isAuthenticated,
          userInfo: authState.userInfo,
          hasToken: !!authState.token
        });
        break;
        
      case 'authenticationUpdated':
        console.log('Authentication updated, refreshing...');
        // Re-initialize authService and re-check auth status
        authService.initialize().then(() => {
          checkAuthStatus();
          respond(true);
        }).catch(error => {
          console.error('Auth update error:', error);
          respond(false, { error: error.message });
        });
        return true;
        
      case 'pollCalendar':
        // Force a calendar poll now
        pollCalendar().then(() => {
          respond(true);
        }).catch(error => {
          console.error('Error polling calendar:', error);
          respond(false, { error: error.message });
        });
        return true;
        
      case 'setReminder':
        if (message.eventId && message.minutesBefore) {
          setReminderForEvent(message.eventId, message.minutesBefore)
            .then(() => respond(true))
            .catch(error => respond(false, { error: error.message }));
          return true;
        }
        respond(false, { error: 'Missing eventId or minutesBefore' });
        return false;
        
      case 'needsTokenRefresh':
        console.log('Received token refresh request from service worker at', new Date().toLocaleTimeString());
        // This is sent by the alarm handler in service worker context
        // We need to refresh the token from here (UI context) where chrome.identity works better
        authService.refreshToken(true).then(token => {
          console.log('Token refreshed successfully from UI context');
          respond(true, { refreshed: true });
          // Re-check auth status to update UI
          checkAuthStatus();
        }).catch(error => {
          console.error('Failed to refresh token from UI context:', error);
          respond(false, { error: error.message });
        });
        return true; // Keep channel open for async response
        
      case 'refreshMeetings':
        console.log('Received refreshMeetings request');
        // Trigger a calendar poll and respond when complete
        pollCalendar()
          .then(() => {
            respond(true, { success: true });
          })
          .catch(error => {
            console.error('Error refreshing meetings:', error);
            respond(false, { 
              error: error.message || 'Failed to refresh meetings',
              details: error.toString()
            });
          });
        return true; // Keep channel open for async response
        
      case 'signIn':
        console.log('Received signIn request');
        // Handle sign in through authService
        authService.login()
          .then(({ token, userInfo }) => {
            console.log('Sign in successful, updating auth state');
            // Update the auth state with the new token and user info
            updateAuthState({
              isAuthenticated: true,
              userInfo,
              token
            });
            
            // Send success response
            respond(true, { 
              success: true, 
              userInfo,
              token: token // Include token in response for debugging
            });
            
            console.log('Auth state updated, sending status update to popup');
            // Trigger a status update to refresh the UI
            setTimeout(() => {
              sendStatusUpdateToPopup();
            }, 100);
            
            return true;
          })
          .catch(error => {
            console.error('Sign in failed:', error);
            // Update auth state to reflect sign out on failure
            updateAuthState({
              isAuthenticated: false,
              userInfo: null,
              token: null
            });
            
            // Send detailed error response
            respond(false, { 
              error: error.message || 'Authentication failed',
              details: error.toString()
            });
            
            return false;
          });
        return true; // Keep channel open for async response
        
      case 'settingsUpdated':
        console.log('Settings updated:', message.settings);
        // Apply any setting changes that affect the background service
        try {
          // Store settings locally to ensure synchronization
          chrome.storage.local.set({ userSettings: message.settings }, () => {
            if (chrome.runtime.lastError) {
              console.error('Error storing settings in background:', chrome.runtime.lastError);
              respond(false, { error: chrome.runtime.lastError.message });
            } else {
              console.log('Settings synchronized in background script');
              respond(true, { received: true });
            }
          });
        } catch (error) {
          console.error('Error processing settings update:', error);
          respond(false, { error: error.message });
        }
        return true; // Keep channel open for async response
    }
  } catch (error) {
    console.error('Error processing message:', error);
    respond(false, { error: error.message });
    return false;
  }
});
