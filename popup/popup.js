/**
 * Google Calendar Callback Extension - Popup
 * Coordinator module that initializes services and controllers
 * 
 * This file is kept deliberately slim following SOLID principles:
 * - Single Responsibility: Only coordinates initialization of other modules
 * - Open/Closed: Adding new features doesn't require modifying this file
 * - Liskov Substitution: Services can be replaced with compatible implementations
 * - Interface Segregation: Each service has focused responsibilities
 * - Dependency Inversion: Services are injected where needed
 */

// Import services and controllers
import errorTracker from '../utils/error-tracking.js';
import authService from './services/auth.service.js';
import settingsService from './services/settings.service.js';
import meetingsService from './services/meetings.service.js';
import uiController from './controllers/ui.controller.js';

// Communication with background service worker
let backgroundPort = null;

/**
 * Initialize the popup when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('Calendar Callback: Popup initialized');
    
    // Set up message listener for background script communications first
    setupMessageListener();
    
    // Initialize the UI controller
    await uiController.init();
    
    // Establish connection with background script
    connectToBackground();
    
    // First check local auth state for immediate UI update
    const isAuthenticated = await checkLocalAuthState();
    
    // Then request fresh status from background
    requestStatusUpdate();
    
    // Set up periodic status updates
    setupPeriodicStatusUpdates();
    
  } catch (error) {
    errorTracker.logError('Error initializing popup', { error });
    console.error('Failed to initialize popup:', error);
    
    // Show error state in UI
    uiController.showErrorState('Failed to initialize: ' + (error.message || 'Unknown error'));
  }
});

/**
 * Check local authentication state for immediate UI update
 */
async function checkLocalAuthState() {
  try {
    // Try to load from sync storage first (persists across devices)
    let data = {};
    try {
      data = await chrome.storage.sync.get('auth_state');
      if (!data.auth_state) {
        data = await chrome.storage.local.get('auth_state');
      }
    } catch (error) {
      console.warn('Error checking local auth state:', error);
      return false;
    }
    
    if (data.auth_state) {
      const now = Date.now();
      const tokenExpiry = data.auth_state.tokenExpiry || 0;
      const tokenRefreshExpiry = data.auth_state.tokenRefreshExpiry || 0;
      const isValid = data.auth_state.token && 
                     (tokenExpiry > now || tokenRefreshExpiry > now);
      
      if (isValid) {
        // Update UI with cached data
        // Pass the userInfo directly to showSignedInUI which will handle the update
        await uiController.showSignedInUI(data.auth_state.userInfo || {});
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.warn('Error in checkLocalAuthState:', error);
    return false;
  }
}

/**
 * Set up periodic status updates while popup is open
 */
function setupPeriodicStatusUpdates() {
  // Request status update every 5 seconds while popup is open
  const statusInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      requestStatusUpdate();
    } else {
      // Clear interval when popup is closed
      clearInterval(statusInterval);
    }
  }, 5000);
  
  // Clean up on page unload
  window.addEventListener('unload', () => {
    clearInterval(statusInterval);
  });
}

/**
 * Connect to the background script using runtime.connect
 * This helps the background script know when the popup is open
 */
function connectToBackground() {
  try {
    // Create a connection to the background script
    backgroundPort = chrome.runtime.connect({ name: 'popup' });
    
    // Listen for disconnect (eg. when popup closes)
    backgroundPort.onDisconnect.addListener(() => {
      console.log('Disconnected from background script');
      backgroundPort = null;
    });
    
    // Listen for messages through the port connection
    backgroundPort.onMessage.addListener((message) => {
      console.log('Received port message from background:', message);
      // Handle port-specific messages if needed
      handlePortMessage(message);
    });
    
    console.log('Connected to background script');
  } catch (error) {
    console.error('Failed to connect to background script:', error);
    errorTracker.logError('Failed to connect to background script', { error });
  }
}

/**
 * Request a status update from the background script with retry logic
 */
function requestStatusUpdate(attempt = 0) {
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY = 500; // ms
  
  try {
    // First check if we have a valid connection
    if (!backgroundPort) {
      connectToBackground();
    }
    
    // Try to send message through port first (lower latency)
    if (backgroundPort) {
      try {
        backgroundPort.postMessage({ action: 'getStatusUpdate' });
        return; // Successfully sent through port
      } catch (portError) {
        console.warn('Port message failed, falling back to runtime message:', portError);
        backgroundPort = null; // Reset port connection for next attempt
      }
    }
    
    // Fall back to runtime message if port fails or doesn't exist
    chrome.runtime.sendMessage({ action: 'getStatusUpdate' }, (response) => {
      // Handle Chrome's special "receiving end does not exist" error
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message && 
            chrome.runtime.lastError.message.includes('receiving end does not exist')) {
          // This is normal when the service worker is starting up
          if (attempt < MAX_ATTEMPTS) {
            console.log(`Service worker not ready, retrying (${attempt + 1}/${MAX_ATTEMPTS})...`);
            setTimeout(() => requestStatusUpdate(attempt + 1), RETRY_DELAY * (attempt + 1));
            
            // Show loading state in UI
            uiController.updateServiceStatus({
              state: 'starting',
              message: 'Starting monitoring service...'
            });
            return;
          }
        }
        
        console.error('Error getting status update:', chrome.runtime.lastError);
        // Show error in UI
        uiController.updateServiceStatus({
          state: 'inactive',
          message: 'Cannot connect to service worker. Please refresh the page.'
        });
        return;
      }
      
      if (response && response.success) {
        handleStatusUpdate(response);
      } else {
        console.error('Failed to get status update:', response && response.error);
        
        // If we have no response but no error, the service worker might be starting
        if (!response && attempt < MAX_ATTEMPTS) {
          console.log(`No response, retrying (${attempt + 1}/${MAX_ATTEMPTS})...`);
          setTimeout(() => requestStatusUpdate(attempt + 1), RETRY_DELAY * (attempt + 1));
          return;
        }
        
        // Show error in UI
        uiController.updateServiceStatus({
          state: 'inactive',
          message: response && response.error 
            ? `Error: ${response.error}` 
            : 'Failed to get status update. Please try again.'
        });
      }
    });
  } catch (error) {
    console.error('Error requesting status update:', error);
    errorTracker.logError('Failed to request status update', { error });
    
    // Show error in UI
    uiController.updateServiceStatus({
      state: 'inactive',
      message: `Error: ${error.message || 'Unknown error'}`
    });
    
    // Retry if possible
    if (attempt < MAX_ATTEMPTS) {
      console.log(`Error occurred, retrying (${attempt + 1}/${MAX_ATTEMPTS})...`);
      setTimeout(() => requestStatusUpdate(attempt + 1), RETRY_DELAY * (attempt + 1));
    }
  }
}

/**
 * Handle messages received through the port connection
 */
function handlePortMessage(message) {
  if (message.type === 'status') {
    handleStatusUpdate(message.data);
  }
}

/**
 * Set up listener for messages from background script
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Popup received message:', message);
    
    // Handle async responses
    const respond = (success, data = {}) => {
      if (sendResponse) {
        sendResponse({ success, ...data });
      }
      return true; // Keep channel open for async response
    };
    
    switch (message.action) {
      case 'refreshMeetings':
        // Background script is asking popup to refresh meetings list
        if (message.data && message.data.meetings) {
          // Use the meetings data provided by the background script
          console.log(`Received ${message.data.meetings.length} meetings from background`);
          uiController.displayMeetings(message.data.meetings)
            .then(() => respond(true))
            .catch(error => {
              errorTracker.logError('Failed to display meetings from background', { error });
              respond(false, { error: error.message });
            });
        } else {
          // Fallback to refreshing from the meetings service
          uiController.refreshMeetingsList()
            .then(() => respond(true))
            .catch(error => {
              errorTracker.logError('Failed to refresh meetings from background request', { error });
              respond(false, { error: error.message });
            });
        }
        return true;
        
      case 'authUpdated':
        // Auth status has been updated (success or failure)
        console.log('Auth status updated:', message.authenticated);
        if (message.authenticated) {
          uiController.showSignedInUI()
            .then(() => {
              // If user info was provided, update it immediately
              if (message.userInfo) {
                uiController.updateUserInfo(message.userInfo);
              }
              respond(true);
            })
            .catch(error => {
              errorTracker.logError('Failed to show signed in UI', { error });
              respond(false, { error: error.message });
            });
        } else {
          uiController.showSignedOutUI();
          respond(true);
        }
        return true;
        
      case 'authNeeded':
        // Authentication is required
        console.log('Authentication needed:', message.message);
        uiController.showSignedOutUI();
        respond(true);
        return true;
        
      case 'authError':
        // Authentication error occurred
        console.error('Authentication error:', message.error);
        uiController.showErrorState(message.error || 'Authentication error');
        respond(false, { error: message.error });
        return true;
        
      case 'statusUpdate':
        // Received a comprehensive status update
        console.log('Status update received:', message.data);
        handleStatusUpdate(message.data);
        respond(true);
        return true;
        
      case 'pollingError':
        // Calendar polling encountered an error
        console.error('Polling error:', message.error);
        uiController.showPollingError(message.error);
        respond(true);
        return true;
        
      default:
        console.warn('Unknown message action:', message.action);
        return false;
    }
  });
}

/**
 * Handle status updates from the background script
 * @param {Object} statusData - Status data from background script
 */
function handleStatusUpdate(statusData) {
  try {
    console.log('Processing status update:', statusData);
    
    // Update authentication status - pass the full status object with user info
    if (statusData.authenticated !== undefined) {
      uiController.updateAuthStatus({
        isAuthenticated: statusData.authenticated,
        userInfo: statusData.userInfo || null,
        userEmail: statusData.userEmail || (statusData.userInfo && statusData.userInfo.email) || null,
        error: statusData.lastError || null
      });
    }
    
    // Update polling status
    if (statusData.lastPollTime) {
      const lastPollTime = new Date(statusData.lastPollTime);
      uiController.updateLastPollTime(lastPollTime);
    }
    
    // Update error status if any
    if (statusData.lastError) {
      uiController.showPollingError(statusData.lastError.message || 'Unknown error');
    } else {
      uiController.clearPollingError();
    }
    
    // Update upcoming meetings if provided
    if (statusData.upcomingMeetings && Array.isArray(statusData.upcomingMeetings)) {
      uiController.displayMeetings(statusData.upcomingMeetings);
    }
    
    // Update polling settings
    if (statusData.pollInterval !== undefined) {
      uiController.updatePollingInterval(statusData.pollInterval);
    }
    
    if (statusData.triggerThreshold !== undefined) {
      uiController.updateTriggerThreshold(statusData.triggerThreshold);
    }
    
    // Update service status with monitoring state
    if (statusData.monitoringState) {
      // Use the new monitoring state if available
      uiController.updateServiceStatus({
        state: statusData.monitoringState,
        message: statusData.lastError ? `Error: ${statusData.lastError}` : undefined
      });
    } else {
      // Fallback to legacy isPolling flag
      uiController.updateServiceStatus({
        state: statusData.isPolling ? 'active' : 'inactive',
        message: statusData.lastError ? `Error: ${statusData.lastError}` : undefined
      });
    }
  } catch (error) {
    console.error('Error handling status update:', error);
    errorTracker.logError('Failed to handle status update', { error });
  }
}
