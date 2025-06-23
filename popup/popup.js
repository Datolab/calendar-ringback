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

/**
 * Initialize the popup when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('Calendar Callback: Popup initialized');
    
    // Error tracking initializes automatically in the constructor
    // No need to call initialize() as it doesn't exist
    
    // Initialize the UI controller
    await uiController.initialize();
    
    // Set up message listener for background script communications
    setupMessageListener();
    
  } catch (error) {
    errorTracker.logError('Error initializing popup', { error });
    console.error('Failed to initialize popup:', error);
  }
});

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
        uiController.refreshMeetingsList()
          .then(() => respond(true))
          .catch(error => {
            errorTracker.logError('Failed to refresh meetings from background request', { error });
            respond(false, { error: error.message });
          });
        return true;
        
      case 'authUpdated':
        // Auth status has been updated (success or failure)
        console.log('Auth status updated:', message.authenticated);
        if (message.authenticated) {
          uiController.showSignedInUI()
            .then(() => respond(true))
            .catch(error => {
              errorTracker.logError('Failed to show signed in UI', { error });
              respond(false, { error: error.message });
            });
        } else {
          uiController.showErrorState(message.error || 'Authentication failed');
          respond(false, { error: message.error || 'Authentication failed' });
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
        
      default:
        console.warn('Unknown message action:', message.action);
        return false;
    }
  });
}
