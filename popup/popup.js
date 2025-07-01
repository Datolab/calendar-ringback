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
    
    // Error tracking initializes automatically in the constructor
    // No need to call initialize() as it doesn't exist
    
    // Initialize the UI controller
    await uiController.init();
    
    // Set up message listener for background script communications
    setupMessageListener();
    
    // Establish connection with background script
    connectToBackground();
    
    // Request immediate status update from background
    requestStatusUpdate();
    
  } catch (error) {
    errorTracker.logError('Error initializing popup', { error });
    console.error('Failed to initialize popup:', error);
  }
});

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
 * Request a status update from the background script
 */
async function requestStatusUpdate() {
  try {
    chrome.runtime.sendMessage(
      { action: 'getStatusUpdate' },
      (response) => {
        if (chrome.runtime.lastError) {
          // This is expected when background isn't ready yet
          console.debug('Status update not available yet:', chrome.runtime.lastError.message);
          
          // Schedule a retry after a short delay
          setTimeout(requestStatusUpdate, 1000);
          return;
        }
        
        if (response && response.success && response.data) {
          // Process the status update
          handleStatusUpdate(response.data);
        } else if (response && !response.success) {
          console.warn('Error in status update response:', response.error || 'Unknown error');
        }
      }
    );
  } catch (error) {
    console.error('Error requesting status update:', error);
    errorTracker.logError('Failed to request status update', { error });
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
    
    // Update authentication status
    if (statusData.authenticated !== undefined) {
      if (statusData.authenticated) {
        uiController.updateAuthStatus(true);
      } else {
        uiController.updateAuthStatus(false);
      }
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
    
    // Show active status in UI
    uiController.updateServiceStatus(statusData.isPolling ? 'polling' : 'idle');
  } catch (error) {
    console.error('Error handling status update:', error);
    errorTracker.logError('Failed to handle status update', { error });
  }
}
