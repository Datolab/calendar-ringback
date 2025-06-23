/**
 * UI Controller for Calendar Ringback popup
 * Handles all DOM interactions and UI state management
 */

import errorTracker from '../../utils/error-tracking.js';
import authService from '../services/auth.service.js';
import settingsService from '../services/settings.service.js';
import meetingsService from '../services/meetings.service.js';

class UIController {
  constructor() {
    // DOM elements
    this.elements = {
      notSignedInSection: null,
      signedInSection: null,
      userEmailSpan: null,
      signInButton: null,
      signOutButton: null,
      statusSection: null,
      statusIcon: null,
      statusText: null,
      upcomingList: null,
      noMeetingsMsg: null,
      notificationTiming: null,
      autoJoinCheckbox: null,
      ringtoneSelect: null,
      testSoundButton: null,
      saveSettingsButton: null,
      firstRunModal: null,
      firstRunContinue: null,
      versionSpan: null
    };
    
    // Audio for ringtone preview
    this.previewAudio = null;
    
    // UI state
    this.isLoading = false;
  }
  
  /**
   * Initialize the UI controller
   */
  async initialize() {
    console.log('Initializing UI controller');
    
    try {
      // Step 1: Check for token right away - most direct way to determine auth status
      let tokenExists = false;
      try {
        const token = await new Promise(resolve => {
          chrome.storage.local.get('oauth_token', (result) => {
            resolve(result && result.oauth_token);
          });
        });
        tokenExists = !!token;
        console.log('Token check:', tokenExists ? 'Token found' : 'No token found');
      } catch (e) {
        console.warn('Could not check for token:', e);
      }
      
      // Step 2: Cache DOM elements (this won't fail now with our changes)
      this._cacheElements();
      console.log('DOM elements cached');
      
      // Step 3: Set up event listeners
      this._setupEventListeners();
      console.log('Event listeners set up');
      
      // Step 4: Display version
      this._displayVersion();
      
      // Step 5: Force handle the welcome modal correctly based on token
      const firstRunModal = document.getElementById('first-run-modal');
      if (firstRunModal) {
        if (tokenExists) {
          console.log('Token exists - forcing welcome modal hidden');
          firstRunModal.style.display = 'none';
          firstRunModal.classList.add('hidden');
          
          // Also mark first run as complete
          await settingsService.completeFirstRun();
        } else {
          // Only verify first-run status if we don't have a token
          const isFirstRun = await settingsService.isFirstRun();
          if (isFirstRun) {
            console.log('First run - showing welcome modal');
            firstRunModal.style.display = 'block';
            firstRunModal.classList.remove('hidden');
          } else {
            console.log('Not first run - hiding welcome modal');
            firstRunModal.style.display = 'none';
            firstRunModal.classList.add('hidden');
          }
        }
      } else {
        console.warn('First run modal not found in DOM');
      }
      
      // Step 6: Update UI based on authentication state
      if (tokenExists) {
        // User is authenticated - show signed in UI
        try {
          console.log('Showing signed-in UI');
          const notSignedInSection = document.getElementById('not-signed-in');
          const signedInSection = document.getElementById('signed-in');
          
          if (notSignedInSection) notSignedInSection.style.display = 'none';
          if (signedInSection) signedInSection.style.display = 'block';
          
          // Load settings and meetings
          await this._loadAndDisplaySettings();
          await this._displayUserEmail();
          await this.refreshMeetingsList();
        } catch (err) {
          console.error('Error updating UI for signed-in state:', err);
        }
      } else {
        // User is not authenticated - show signed out UI
        try {
          console.log('Showing signed-out UI');
          const notSignedInSection = document.getElementById('not-signed-in');
          const signedInSection = document.getElementById('signed-in');
          
          if (notSignedInSection) notSignedInSection.style.display = 'block';
          if (signedInSection) signedInSection.style.display = 'none';
        } catch (err) {
          console.error('Error updating UI for signed-out state:', err);
        }
      }
      
      console.log('UI controller initialization complete');
      return true;
      
    } catch (error) {
      console.error('Fatal error in UI initialization:', error);
      try {
        // Last-resort error handling - try to show something useful
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = 'Initialization error. Please reload the extension.';
        document.body.appendChild(errorDiv);
      } catch (e) {} // Suppress any further errors
      
      return false;
    }
  }
  
  /**
   * Show the signed out UI state
   */
  showSignedOutUI() {
    this.elements.notSignedInSection.style.display = 'block';
    this.elements.signedInSection.style.display = 'none';
    this.elements.statusText.textContent = 'Not signed in';
    this.elements.statusIcon.className = 'status-icon not-signed-in';
  }
  
  /**
   * Show the signed in UI state
   */
  async showSignedInUI() {
    console.log('showSignedInUI called');
    try {
      // Check if we actually have the needed elements
      console.log('Element check before showing signed-in UI:', { 
        notSignedInSection: !!this.elements.notSignedInSection,
        signedInSection: !!this.elements.signedInSection,
        firstRunModal: !!this.elements.firstRunModal
      });
      
      // Update UI visibility
      if (this.elements.notSignedInSection) {
        console.log('Hiding not-signed-in section');
        this.elements.notSignedInSection.style.display = 'none';
      } else {
        console.error('notSignedInSection element not found!');
      }
      
      if (this.elements.signedInSection) {
        console.log('Showing signed-in section');
        this.elements.signedInSection.style.display = 'block';
      } else {
        console.error('signedInSection element not found!');
      }
      
      if (this.elements.statusText) {
        this.elements.statusText.textContent = 'Active';
      }
      
      if (this.elements.statusIcon) {
        this.elements.statusIcon.className = 'status-icon active';
      }
      
      console.log('Hiding first run modal from showSignedInUI');
      this.hideOnboardingModal();
      
      // Force hide the modal with direct DOM access as a failsafe
      const directModalElement = document.getElementById('first-run-modal');
      if (directModalElement) {
        console.log('Directly hiding modal via getElementById');
        directModalElement.style.display = 'none';
      } else {
        console.error('Modal not found via direct getElementById!');
      }
      
      // Load settings
      await this._loadAndDisplaySettings();
      
      // Display user email
      await this._displayUserEmail();
      
      // Load and display upcoming meetings
      await this.refreshMeetingsList();
      
      console.log('Signed in UI shown successfully');
    } catch (error) {
      console.error('Error in showSignedInUI:', error);
      errorTracker.logError('Error showing signed in UI', { error });
      this.showErrorState('Error loading user data');
    }
  }
  
  /**
   * Show the authenticating UI state
   */
  showAuthenticatingUI() {
    this.elements.notSignedInSection.style.display = 'block';
    this.elements.signedInSection.style.display = 'none';
    this.elements.statusText.textContent = 'Authenticating...';
    this.elements.statusIcon.className = 'status-icon loading';
    
    // Disable sign-in button and update text
    if (this.elements.signInButton) {
      this.elements.signInButton.disabled = true;
      this.elements.signInButton.textContent = 'Authenticating...';
    }
    
    // Disable onboarding button if visible
    if (this.elements.firstRunContinue) {
      this.elements.firstRunContinue.disabled = true;
      this.elements.firstRunContinue.textContent = 'Authenticating...';
    }
  }
  
  /**
   * Show an error state in the UI
   * @param {string} message - Error message to display
   */
  showErrorState(message) {
    // Add null checks for all element accesses
    if (this.elements.statusText) {
      this.elements.statusText.textContent = message || 'Error';
    } else {
      console.error('Status text element not found');
    }
    
    if (this.elements.statusIcon) {
      this.elements.statusIcon.className = 'status-icon error';
    }
    
    // Re-enable buttons
    if (this.elements.signInButton) {
      this.elements.signInButton.disabled = false;
      this.elements.signInButton.textContent = 'Sign In';
    }
    
    if (this.elements.firstRunContinue) {
      this.elements.firstRunContinue.disabled = false;
      this.elements.firstRunContinue.textContent = 'Get Started';
    }
    
    // Log error to console for debugging
    console.error(`UI Error: ${message}`, {
      elementsFound: {
        statusText: !!this.elements.statusText,
        statusIcon: !!this.elements.statusIcon,
        signInButton: !!this.elements.signInButton,
        firstRunContinue: !!this.elements.firstRunContinue
      }
    });
  }
  
  /**
   * Show the onboarding modal
   */
  showOnboardingModal() {
    if (this.elements.firstRunModal) {
      this.elements.firstRunModal.style.display = 'block';
    }
  }
  
  /**
   * Hide the onboarding modal
   */
  hideOnboardingModal() {
    console.log('Hiding onboarding modal');
    if (this.elements.firstRunModal) {
      console.log('Found firstRunModal element, hiding it');
      this.elements.firstRunModal.style.display = 'none';
      
      // Force a reflow to ensure the display change takes effect
      void this.elements.firstRunModal.offsetHeight;
      
      // Verify the modal is hidden
      console.log('Modal display style after hiding:', 
        window.getComputedStyle(this.elements.firstRunModal).display);
    } else {
      console.error('firstRunModal element not found when trying to hide it');
      console.log('Available elements:', Object.keys(this.elements));
    }
  }
  
  /**
   * Refresh the meetings list
   */
  async refreshMeetingsList() {
    try {
      this.isLoading = true;
      
      // Show loading state
      this.elements.upcomingList.innerHTML = '<li class="loading">Loading meetings...</li>';
      
      // Load upcoming meetings
      const meetings = await meetingsService.loadUpcomingMeetings();
      
      // Update UI with meetings
      this._displayMeetings(meetings);
    } catch (error) {
      errorTracker.logError('Error refreshing meetings list', { error });
      this.elements.upcomingList.innerHTML = '<li class="error">Failed to load meetings</li>';
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Handle the sign in button click
   */
  async handleSignIn() {
    try {
      // Update UI
      this.showAuthenticatingUI();
      
      // Attempt to sign in
      await authService.signIn();
      
      // Update UI
      await this.showSignedInUI();
      
      // Mark first run complete if this is the first run
      const isFirstRun = await settingsService.isFirstRun();
      if (isFirstRun) {
        await settingsService.completeFirstRun();
      }
    } catch (error) {
      errorTracker.logError('Sign in failed', { error });
      this.showErrorState('Authentication failed');
    }
  }
  
  /**
   * Handle the sign out button click
   */
  async handleSignOut() {
    try {
      await authService.signOut();
      this.showSignedOutUI();
    } catch (error) {
      errorTracker.logError('Sign out failed', { error });
      this.showErrorState('Failed to sign out');
    }
  }
  
  /**
   * Handle the save settings button click
   */
  async handleSaveSettings() {
    try {
      // Show loading state
      this.elements.saveSettingsButton.disabled = true;
      this.elements.saveSettingsButton.textContent = 'Saving...';
      
      // Get values from form inputs
      const settings = {
        notificationTiming: parseInt(this.elements.notificationTiming.value, 10),
        autoJoin: this.elements.autoJoinCheckbox.checked,
        ringtone: this.elements.ringtoneSelect.value
      };
      
      // Save settings
      await settingsService.saveSettings(settings);
      
      // Show success state
      this.elements.saveSettingsButton.textContent = 'Saved!';
      
      // Reset button after a delay
      setTimeout(() => {
        this.elements.saveSettingsButton.disabled = false;
        this.elements.saveSettingsButton.textContent = 'Save Settings';
      }, 1500);
    } catch (error) {
      errorTracker.logError('Failed to save settings', { error });
      this.elements.saveSettingsButton.disabled = false;
      this.elements.saveSettingsButton.textContent = 'Save Failed';
      
      // Reset button after a delay
      setTimeout(() => {
        this.elements.saveSettingsButton.textContent = 'Save Settings';
      }, 1500);
    }
  }
  
  /**
   * Handle the test ringtone button click
   */
  handleTestRingtone() {
    try {
      // Stop any playing preview
      this._stopRingtonePreview();
      
      // Get selected ringtone
      const selectedRingtone = this.elements.ringtoneSelect.value;
      
      // Create new audio element
      this.previewAudio = new Audio(`../assets/audio/${selectedRingtone}-ring.mp3`);
      
      // Set up event handler for when playback ends
      this.previewAudio.addEventListener('ended', () => {
        this._stopRingtonePreview();
      });
      
      // Play the audio
      this.previewAudio.play();
      
      // Update button text
      this.elements.testSoundButton.textContent = 'Stop';
      
      // Change button function to stop playback
      this.elements.testSoundButton.onclick = () => this._stopRingtonePreview();
    } catch (error) {
      errorTracker.logError('Failed to play ringtone preview', { error });
    }
  }
  
  /**
   * Handle the first run continue/get started button click
   */
  async handleFirstRunContinue() {
    try {
      console.log('First run continue clicked');
      
      // Mark first run as complete
      await settingsService.completeFirstRun();
      console.log('First run marked as complete');
      
      // Hide the onboarding modal
      this.hideOnboardingModal();
      console.log('Onboarding modal hidden');
      
      // Start authentication flow
      await this.handleSignIn();
    } catch (error) {
      console.error('Error in handleFirstRunContinue:', error);
      errorTracker.logError('Failed to complete first run', { error });
      this.showErrorState('Failed to complete setup');
    }
  }
  
  // PRIVATE METHODS
  
  /**
   * Cache DOM elements
   * @returns {boolean} - Always returns true to ensure initialization can continue
   * @private
   */
  _cacheElements() {
    this.elements = {};
    
    // Helper function to safely get elements
    const getElement = (id) => {
      const element = document.getElementById(id);
      if (!element) {
        console.warn(`Element not found: ${id}`);
      }
      return element;
    };
    
    // Cache all elements with correct hyphenated IDs
    this.elements.notSignedInSection = getElement('not-signed-in');
    this.elements.signedInSection = getElement('signed-in');
    this.elements.userEmailSpan = getElement('user-email');
    this.elements.signInButton = getElement('signin-button');
    this.elements.signOutButton = getElement('signout-button');
    this.elements.statusSection = getElement('status-section');
    this.elements.statusIcon = getElement('status-icon');
    this.elements.statusText = getElement('status-text');
    this.elements.upcomingList = getElement('upcoming-list');
    this.elements.noMeetingsMsg = getElement('no-meetings');
    this.elements.notificationTiming = getElement('notification-timing');
    this.elements.autoJoinCheckbox = getElement('auto-join');
    this.elements.ringtoneSelect = getElement('ringtone');
    this.elements.testSoundButton = getElement('test-sound');
    this.elements.saveSettingsButton = getElement('save-settings');
    this.elements.firstRunModal = getElement('first-run-modal');
    this.elements.firstRunContinue = getElement('first-run-continue');
    this.elements.versionSpan = getElement('version');
    
    // Always return true to ensure initialization can continue
    // even if some non-critical elements are missing
    return true;
  }
  
  /**
   * Set up event listeners for UI interactions
   * @private
   */
  _setupEventListeners() {
    // Sign in and out buttons
    if (this.elements.signInButton) {
      this.elements.signInButton.addEventListener('click', () => this.handleSignIn());
    }
    
    if (this.elements.signOutButton) {
      this.elements.signOutButton.addEventListener('click', () => this.handleSignOut());
    }
    
    // Settings buttons
    if (this.elements.saveSettingsButton) {
      this.elements.saveSettingsButton.addEventListener('click', () => this.handleSaveSettings());
    }
    
    if (this.elements.testSoundButton) {
      this.elements.testSoundButton.addEventListener('click', () => this.handleTestRingtone());
    }
    
    // First run modal button
    if (this.elements.firstRunContinue) {
      console.log('Setting up first run continue button listener', this.elements.firstRunContinue);
      
      // Enhanced event listener with debugging
      this.elements.firstRunContinue.addEventListener('click', () => {
        console.log('First run continue button clicked!');
        this.handleFirstRunContinue();
      });
      
      // Add visual feedback to help debug
      this.elements.firstRunContinue.style.position = 'relative';
      this.elements.firstRunContinue.onmouseover = () => {
        console.log('First run button mouseover');
        this.elements.firstRunContinue.style.outline = '2px solid red';
      };
      this.elements.firstRunContinue.onmouseout = () => {
        this.elements.firstRunContinue.style.outline = 'none';
      };
    } else {
      console.error('First run continue button not found during event listener setup');
    }
  }
  
  /**
   * Display the extension version in the UI
   * @private
   */
  _displayVersion() {
    if (this.elements.versionSpan) {
      const manifest = chrome.runtime.getManifest();
      this.elements.versionSpan.textContent = manifest.version || '1.0.0';
    }
  }
  
  /**
   * Load settings and update UI form elements
   * @private
   */
  async _loadAndDisplaySettings() {
    try {
      // Load settings
      const settings = await settingsService.loadSettings();
      
      // Update form inputs
      if (this.elements.notificationTiming) {
        this.elements.notificationTiming.value = settings.notificationTiming;
      }
      
      if (this.elements.autoJoinCheckbox) {
        this.elements.autoJoinCheckbox.checked = settings.autoJoin;
      }
      
      if (this.elements.ringtoneSelect) {
        this.elements.ringtoneSelect.value = settings.ringtone;
      }
    } catch (error) {
      errorTracker.logError('Failed to load and display settings', { error });
    }
  }
  
  /**
   * Display the user's email address
   * @private
   */
  async _displayUserEmail() {
    try {
      if (this.elements.userEmailSpan) {
        // Get user info
        const userInfo = await authService.getUserInfo();
        
        // Display email
        this.elements.userEmailSpan.textContent = userInfo.email || 'user@example.com';
      }
    } catch (error) {
      errorTracker.logError('Failed to display user email', { error });
      if (this.elements.userEmailSpan) {
        this.elements.userEmailSpan.textContent = 'user@example.com';
      }
    }
  }
  
  /**
   * Display meetings in the UI
   * @param {Array} meetings - Array of meeting objects
   * @private
   */
  _displayMeetings(meetings) {
    // Clear existing content
    this.elements.upcomingList.innerHTML = '';
    
    // Show message if no meetings
    if (!meetings || meetings.length === 0) {
      this.elements.noMeetingsMsg.style.display = 'block';
      return;
    }
    
    // Hide no meetings message
    this.elements.noMeetingsMsg.style.display = 'none';
    
    // Add each meeting to the list
    meetings.forEach(meeting => {
      const li = document.createElement('li');
      
      // Format start time
      const startTime = new Date(meeting.start);
      const timeStr = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      // Create meeting HTML
      li.innerHTML = `
        <div class="meeting-time">${timeStr}</div>
        <div class="meeting-info">
          <div class="meeting-title">${meeting.title}</div>
          <div class="meeting-organizer">
            <span class="organizer-label">Organizer:</span>
            <span class="organizer-name">${meeting.organizer}</span>
          </div>
        </div>
        <div class="meeting-actions">
          <a href="${meeting.meetLink}" target="_blank" class="join-button">Join</a>
        </div>
      `;
      
      // Add to list
      this.elements.upcomingList.appendChild(li);
    });
  }
  
  /**
   * Stop the ringtone preview playback
   * @private
   */
  _stopRingtonePreview() {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.currentTime = 0;
      this.previewAudio = null;
    }
    
    // Reset button text and handler
    if (this.elements.testSoundButton) {
      this.elements.testSoundButton.textContent = 'Test Sound';
      this.elements.testSoundButton.onclick = () => this.handleTestRingtone();
    }
  }
  
  /**
   * Get stored authentication data
   * @returns {Promise<Object>} The stored authentication data
   * @private
   */
  async _getStoredAuthData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['oauth_token', 'token_expiry', 'authInProgress'], (data) => {
        resolve(data || {});
      });
    });
  }
}

// Export as singleton
const uiController = new UIController();
export default uiController;
