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
    
    // Wait for DOM to be fully ready before proceeding
    await new Promise(resolve => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        resolve();
      } else {
        document.addEventListener('DOMContentLoaded', resolve);
      }
    });
    
    try {
      // Step 1: Cache DOM elements
      this._cacheElements();
      console.log('DOM elements cached');
      
      // Step 2: Set up event listeners
      this._setupEventListeners();
      console.log('Event listeners set up');
      
      // Step 3: Display version
      this._displayVersion();
      
      // Step 4: Check authentication status
      try {
        const isAuthenticated = await authService.isAuthenticated();
        console.log('Auth status check:', isAuthenticated ? 'Authenticated' : 'Not authenticated');
        
        if (isAuthenticated) {
          // Show signed-in UI
          this.showSignedInUI();
          
          // Load and display settings
          try {
            await this._loadAndDisplaySettings();
          } catch (settingsError) {
            console.error('Error loading settings:', settingsError);
            errorTracker.logError('Failed to load settings', { error: settingsError });
          }
          
          // Load meetings
          this.refreshMeetingsList();
        } else {
          // Show sign-in UI
          this.showSignedOutUI();
        }
      } catch (authError) {
        console.error('Error checking authentication status:', authError);
        errorTracker.logError('Auth check failed', { error: authError });
        this.showSignedOutUI();
      }
      
      // Handle first run modal
      try {
        const firstRunModal = document.getElementById('first-run-modal');
        if (firstRunModal) {
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
        } else {
          console.warn('First run modal not found in DOM');
        }
      } catch (modalError) {
        console.error('Error handling first run modal:', modalError);
        errorTracker.logError('First run modal error', { error: modalError });
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
      } catch (e) {
        console.error('Failed to show error message:', e);
      }
      
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
    console.log('=== showSignedInUI ===');
    try {
      // Verify DOM elements are available
      if (!this.elements) {
        console.error('UI elements not initialized!');
        this._cacheElements();
      }
      
      // Log element states for debugging
      console.log('UI element states:', { 
        notSignedInSection: !!this.elements.notSignedInSection,
        signedInSection: !!this.elements.signedInSection,
        firstRunModal: !!this.elements.firstRunModal,
        notificationTiming: !!this.elements.notificationTiming,
        autoJoinCheckbox: !!this.elements.autoJoinCheckbox,
        ringtoneSelect: !!this.elements.ringtoneSelect
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
      
      try {
        // Load and display user info
        console.log('Loading user email...');
        await this._displayUserEmail();
        
        // Load and display settings
        console.log('Loading and displaying settings...');
        await this._loadAndDisplaySettings();
        
        // Refresh meetings
        console.log('Refreshing meetings...');
        await this.refreshMeetingsList();
        
        console.log('✅ Successfully showed signed-in UI');
      } catch (settingsError) {
        console.error('Error loading user data:', settingsError);
        errorTracker.logError('Failed to load user data', { 
          error: settingsError.message || String(settingsError),
          stack: settingsError.stack 
        });
        throw settingsError;
      }
      
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
      return true;
    } catch (error) {
      errorTracker.logError('Error refreshing meetings list', { error });
      this.elements.upcomingList.innerHTML = '<li class="error">Failed to load meetings</li>';
      throw error;
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Display meetings in the UI (public method)
   * @param {Array} meetings - Array of meeting objects
   */
  displayMeetings(meetings) {
    // Simply pass to the internal implementation
    this._displayMeetings(meetings);
  }

  /**
   * Display meetings from an external source (like background script)
   * @param {Array} meetings - Array of meeting objects
   * @returns {Promise<boolean>} - Whether the operation succeeded
   */
  async displayMeetings(meetings) {
    try {
      // Update UI with meetings
      this._displayMeetings(meetings);
      return true;
    } catch (error) {
      errorTracker.logError('Error displaying provided meetings', { error });
      this.elements.upcomingList.innerHTML = '<li class="error">Failed to display meetings</li>';
      throw error;
    }
  }

  /**
   * Update the authentication status display
   * @param {boolean} isAuthenticated - Whether the user is authenticated
   */
  updateAuthStatus(isAuthenticated) {
    try {
      if (isAuthenticated) {
        if (this.elements.notSignedInSection) this.elements.notSignedInSection.style.display = 'none';
        if (this.elements.signedInSection) this.elements.signedInSection.style.display = 'block';
        if (this.elements.statusSection) this.elements.statusSection.classList.remove('hidden');
        if (this.elements.statusText) this.elements.statusText.textContent = 'Active';
        if (this.elements.statusIcon) this.elements.statusIcon.className = 'status-icon active';
      } else {
        if (this.elements.notSignedInSection) this.elements.notSignedInSection.style.display = 'block';
        if (this.elements.signedInSection) this.elements.signedInSection.style.display = 'none';
        if (this.elements.statusSection) this.elements.statusSection.classList.add('hidden');
        if (this.elements.statusText) this.elements.statusText.textContent = 'Not signed in';
        if (this.elements.statusIcon) this.elements.statusIcon.className = 'status-icon not-signed-in';
      }
      return true;
    } catch (error) {
      console.error('Error updating auth status display:', error);
      return false;
    }
  }

  /**
   * Update the user info display
   * @param {Object} userInfo - User profile information
   */
  updateUserInfo(userInfo) {
    try {
      if (this.elements.userEmailSpan && userInfo && userInfo.email) {
        this.elements.userEmailSpan.textContent = userInfo.email;
      }
      return true;
    } catch (error) {
      console.error('Error updating user info display:', error);
      return false;
    }
  }

  /**
   * Update the last poll time display
   * @param {Date} lastPollTime - The time of the last calendar poll
   */
  updateLastPollTime(lastPollTime) {
    try {
      const statusFooter = document.getElementById('status-footer');
      if (!statusFooter) return false;
      
      let lastPollSpan = document.getElementById('last-poll-time');
      if (!lastPollSpan) {
        lastPollSpan = document.createElement('span');
        lastPollSpan.id = 'last-poll-time';
        statusFooter.appendChild(lastPollSpan);
      }
      
      if (lastPollTime) {
        const timeStr = lastPollTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lastPollSpan.textContent = `Last updated: ${timeStr}`;
      } else {
        lastPollSpan.textContent = 'Never updated';
      }
      
      return true;
    } catch (error) {
      console.error('Error updating last poll time display:', error);
      return false;
    }
  }

  /**
   * Show polling error in the UI
   * @param {string} errorMessage - Error message to display
   */
  showPollingError(errorMessage) {
    try {
      const errorDiv = document.getElementById('polling-error');
      if (errorDiv) {
        errorDiv.textContent = errorMessage;
        errorDiv.classList.remove('hidden');
      } else {
        // Create error div if it doesn't exist
        const newErrorDiv = document.createElement('div');
        newErrorDiv.id = 'polling-error';
        newErrorDiv.className = 'error-message';
        newErrorDiv.textContent = errorMessage;
        
        // Insert after status section
        if (this.elements.statusSection && this.elements.statusSection.parentNode) {
          this.elements.statusSection.parentNode.insertBefore(
            newErrorDiv, 
            this.elements.statusSection.nextSibling
          );
        } else {
          // Fallback: add to the end of the container
          const container = document.querySelector('.container');
          if (container) container.appendChild(newErrorDiv);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error showing polling error:', error);
      return false;
    }
  }

  /**
   * Clear polling error in the UI
   */
  clearPollingError() {
    try {
      const errorDiv = document.getElementById('polling-error');
      if (errorDiv) {
        errorDiv.classList.add('hidden');
      }
      return true;
    } catch (error) {
      console.error('Error clearing polling error:', error);
      return false;
    }
  }

  /**
   * Update the service status display
   * @param {string} status - Current service status ('polling', 'idle', 'error')
   */
  updateServiceStatus(status) {
    try {
      if (!this.elements.statusIcon || !this.elements.statusText) return false;
      
      switch (status) {
        case 'polling':
          this.elements.statusIcon.className = 'status-icon polling';
          this.elements.statusText.textContent = 'Polling for meetings...';
          break;
          
        case 'idle':
          this.elements.statusIcon.className = 'status-icon active';
          this.elements.statusText.textContent = 'Active';
          break;
          
        case 'error':
          this.elements.statusIcon.className = 'status-icon error';
          this.elements.statusText.textContent = 'Error';
          break;
          
        default:
          this.elements.statusIcon.className = 'status-icon active';
          this.elements.statusText.textContent = 'Active';
      }
      
      return true;
    } catch (error) {
      console.error('Error updating service status:', error);
      return false;
    }
  }

  /**
   * Update the polling interval display
   * @param {number} interval - Polling interval in minutes
   */
  updatePollingInterval(interval) {
    try {
      // Create or update polling info in UI
      let pollingInfo = document.getElementById('polling-info');
      if (!pollingInfo) {
        pollingInfo = document.createElement('div');
        pollingInfo.id = 'polling-info';
        pollingInfo.className = 'status-details';
        
        if (this.elements.statusSection) {
          this.elements.statusSection.appendChild(pollingInfo);
        }
      }
      
      const intervalSpan = pollingInfo.querySelector('.polling-interval') || document.createElement('div');
      intervalSpan.className = 'polling-interval';
      intervalSpan.textContent = `Calendar checked every ${interval} minute${interval !== 1 ? 's' : ''}`;
      
      // Add to DOM if it's new
      if (!intervalSpan.parentNode) {
        pollingInfo.appendChild(intervalSpan);
      }
      
      return true;
    } catch (error) {
      console.error('Error updating polling interval display:', error);
      return false;
    }
  }

  /**
   * Update the trigger threshold display
   * @param {number} threshold - Trigger threshold in minutes
   */
  updateTriggerThreshold(threshold) {
    try {
      // Create or update polling info in UI
      let pollingInfo = document.getElementById('polling-info');
      if (!pollingInfo) {
        pollingInfo = document.createElement('div');
        pollingInfo.id = 'polling-info';
        pollingInfo.className = 'status-details';
        
        if (this.elements.statusSection) {
          this.elements.statusSection.appendChild(pollingInfo);
        }
      }
      
      const thresholdSpan = pollingInfo.querySelector('.trigger-threshold') || document.createElement('div');
      thresholdSpan.className = 'trigger-threshold';
      thresholdSpan.textContent = `Notifications ${threshold} minute${threshold !== 1 ? 's' : ''} before meetings`;
      
      // Add to DOM if it's new
      if (!thresholdSpan.parentNode) {
        pollingInfo.appendChild(thresholdSpan);
      }
      
      return true;
    } catch (error) {
      console.error('Error updating trigger threshold display:', error);
      return false;
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
    console.log('💾 UI: === START handleSaveSettings ===');
    try {
      // Show loading state
      this.elements.saveSettingsButton.disabled = true;
      this.elements.saveSettingsButton.textContent = 'Saving...';
      
      // Get values from form inputs and convert notification timing to seconds
      const notificationTimingMinutes = parseInt(this.elements.notificationTiming.value, 10);
      console.log('💾 UI: Raw notification timing value from UI:', this.elements.notificationTiming.value, 'Parsed as minutes:', notificationTimingMinutes);
      
      const settings = {
        notificationTiming: notificationTimingMinutes * 60, // Convert minutes to seconds
        autoJoin: this.elements.autoJoinCheckbox.checked,
        ringtone: this.elements.ringtoneSelect.value
      };
      
      console.log('💾 UI: Settings to be saved (in seconds):', {
        ...settings,
        notificationTimingInMinutes: settings.notificationTiming / 60
      });
      
      console.log('💾 UI: Current form values -', {
        notificationTiming: {
          minutes: notificationTimingMinutes,
          seconds: settings.notificationTiming,
          elementValue: this.elements.notificationTiming.value
        },
        autoJoin: {
          checked: this.elements.autoJoinCheckbox.checked,
          elementValue: this.elements.autoJoinCheckbox.checked
        },
        ringtone: {
          value: this.elements.ringtoneSelect.value,
          elementValue: this.elements.ringtoneSelect.value
        }
      });
      
      try {
        console.log('💾 UI: Attempting to save settings...');
        await settingsService.saveSettings(settings);
        console.log('✅ UI: Settings saved successfully');
        
        // Verify the settings were saved correctly
        console.log('🔍 UI: Verifying saved settings by loading them back...');
        const verifiedSettings = await settingsService.loadSettings();
        
        console.log('🔍 UI: Verified settings from storage:', {
          notificationTiming: verifiedSettings.notificationTiming,
          autoJoin: verifiedSettings.autoJoin,
          ringtone: verifiedSettings.ringtone,
          firstRun: verifiedSettings.firstRun
        });
        
        // Show success state
        this.elements.saveSettingsButton.textContent = '✓ Saved';
        console.log('✅ UI: Settings verification successful');
        
        // Force reload settings to UI
        console.log('🔄 UI: Forcing UI to reload settings...');
        await this._loadAndDisplaySettings();
        
        // Reset button after a delay
        setTimeout(() => {
          this.elements.saveSettingsButton.disabled = false;
          this.elements.saveSettingsButton.textContent = 'Save Settings';
        }, 1500);
        
      } catch (storageError) {
        console.error('❌ UI: Error saving settings:', storageError);
        errorTracker.logError('Save settings failed', { 
          error: storageError.message || String(storageError),
          stack: storageError.stack
        });
        this.elements.saveSettingsButton.textContent = 'Save Failed';
        throw new Error(`Failed to save settings: ${storageError.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
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
      // If we already have audio playing, just stop it and reset UI
      if (this.previewAudio) {
        this._stopRingtonePreview();
        return;
      }

      // Get selected ringtone
      const selectedRingtone = this.elements.ringtoneSelect.value;
      
      // Update button text immediately to show loading state
      this.elements.testSoundButton.textContent = 'Loading...';
      
      // Create new audio element with preloading
      this.previewAudio = new Audio();
      
      // Set up event handlers
      this.previewAudio.addEventListener('canplaythrough', async () => {
        try {
          // Only play if we still have a reference (user hasn't cancelled)
          if (this.previewAudio) {
            // Wait briefly to ensure any previous audio operations are complete
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Update button before playing
            this.elements.testSoundButton.textContent = 'Stop';
            
            // Try playing with better error handling
            try {
              const playPromise = this.previewAudio.play();
              if (playPromise !== undefined) {
                playPromise.catch(e => {
                  console.warn('Audio play promise rejected:', e);
                });
              }
            } catch (playError) {
              console.error('Error during audio play:', playError);
            }
          }
        } catch (e) {
          console.error('Error in canplaythrough handler:', e);
        }
      });
      
      this.previewAudio.addEventListener('ended', () => {
        this._stopRingtonePreview();
      });
      
      this.previewAudio.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        this._stopRingtonePreview();
      });
      
      // Set source after adding event listeners
      this.previewAudio.src = `../assets/audio/${selectedRingtone}-ring.mp3`;
      this.previewAudio.load(); // Start loading the audio
      
      // Change button function to stop playback
      this.elements.testSoundButton.onclick = () => this._stopRingtonePreview();
    } catch (error) {
      console.error('Failed to play ringtone preview:', error);
      errorTracker.logError('Failed to play ringtone preview', { error });
      this._stopRingtonePreview(); // Clean up on error
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
    console.log('🔄 UI: === _loadAndDisplaySettings ===');
    try {
      // Ensure elements are cached
      if (!this.elements.notificationTiming || !this.elements.autoJoinCheckbox || !this.elements.ringtoneSelect) {
        console.log('🔄 UI: Re-caching elements before loading settings');
        this._cacheElements();
      }

      // Load settings
      console.log('🔄 UI: Loading settings from storage...');
      const settings = await settingsService.loadSettings();
      
      console.log('🔍 UI: Loaded settings from storage:', {
        notificationTiming: settings.notificationTiming,
        autoJoin: settings.autoJoin,
        ringtone: settings.ringtone,
        firstRun: settings.firstRun
      });
      
      // Update notification timing
      if (this.elements.notificationTiming) {
        // Define valid options for notification timing (in minutes)
        const validMinutes = [0, 1, 3, 5, 10];
        
        // Convert seconds to minutes for the UI (default to 5 minutes if not set)
        const timingSeconds = settings.notificationTiming ?? 300; // Default to 5 minutes (300 seconds) if null/undefined
        const timingMinutes = Math.round(timingSeconds / 60);
        
        console.log('🔄 UI: Processing notification timing -', {
          rawSetting: settings.notificationTiming,
          timingSeconds,
          timingMinutes,
          isZero: timingMinutes === 0 ? 'ZERO' : 'NON-ZERO',  // Highlight if zero
          validOptions: validMinutes
        });
        
        // Ensure the value is one of the valid options (0, 1, 3, 5, 10)
        let closestMatch = validMinutes.reduce((prev, curr) => 
          Math.abs(curr - timingMinutes) < Math.abs(prev - timingMinutes) ? curr : prev
        );
        
        // Special case: if timing is exactly 0, use 0 (don't round up to 1)
        if (timingMinutes === 0) {
          closestMatch = 0;
        }
        
        console.log('🔄 UI: Setting notificationTiming select value to:', closestMatch);
        
        // Store the current value to detect changes
        const oldValue = this.elements.notificationTiming.value;
        
        // Update the select value
        this.elements.notificationTiming.value = closestMatch.toString();
        
        // Force UI update if the value changed
        if (this.elements.notificationTiming.value !== oldValue) {
          this.elements.notificationTiming.dispatchEvent(new Event('change'));
        }
        
        console.log('✅ UI: notificationTiming select value after set:', this.elements.notificationTiming.value, {
          element: this.elements.notificationTiming,
          selectedIndex: this.elements.notificationTiming.selectedIndex,
          selectedText: this.elements.notificationTiming.options[this.elements.notificationTiming.selectedIndex]?.text
        });
      } else {
        console.error('❌ UI: notificationTiming select element not found in DOM');
      }
      
      // Update auto-join checkbox
      if (this.elements.autoJoinCheckbox) {
        const autoJoinValue = settings.autoJoin === true || settings.autoJoin === 'true' || settings.autoJoin === 1;
        console.log('🔄 UI: Setting autoJoinCheckbox to:', autoJoinValue);
        
        // Store the current value to detect changes
        const oldValue = this.elements.autoJoinCheckbox.checked;
        
        // Update the checkbox state
        this.elements.autoJoinCheckbox.checked = autoJoinValue;
        
        // Force UI update if the value changed
        if (this.elements.autoJoinCheckbox.checked !== oldValue) {
          this.elements.autoJoinCheckbox.dispatchEvent(new Event('change'));
        }
        
        console.log('✅ UI: autoJoinCheckbox after setting:', {
          checked: this.elements.autoJoinCheckbox.checked,
          value: this.elements.autoJoinCheckbox.value,
          element: this.elements.autoJoinCheckbox
        });
      } else {
        console.error('❌ UI: autoJoinCheckbox element not found in DOM');
      }
      
      // Update ringtone select
      if (this.elements.ringtoneSelect) {
        const ringtoneValue = settings.ringtone || 'classic';
        console.log('🔄 UI: Setting ringtoneSelect to:', ringtoneValue);
        
        // Store the current value to detect changes
        const oldValue = this.elements.ringtoneSelect.value;
        
        // Update the select value
        this.elements.ringtoneSelect.value = ringtoneValue;
        
        // Force UI update if the value changed
        if (this.elements.ringtoneSelect.value !== oldValue) {
          this.elements.ringtoneSelect.dispatchEvent(new Event('change'));
        }
        
        console.log('✅ UI: ringtoneSelect after setting:', {
          value: this.elements.ringtoneSelect.value,
          selectedIndex: this.elements.ringtoneSelect.selectedIndex,
          selectedText: this.elements.ringtoneSelect.options[this.elements.ringtoneSelect.selectedIndex]?.text,
          element: this.elements.ringtoneSelect
        });
      } else {
        console.error('❌ UI: ringtoneSelect element not found in DOM');
      }
      
      console.log('🔄 UI: Settings applied to UI elements');
    } catch (error) {
      console.error('🔄 UI: Failed to load and display settings:', error);
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
        // Get user info with silent error handling during initialization
        const userInfo = await authService.getUserInfo(true);
        
        // Display email
        this.elements.userEmailSpan.textContent = userInfo.email || 'user@example.com';
      }
    } catch (error) {
      console.warn('Failed to display user email:', error.message);
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
      li.classList.add('meeting-item');
      
      // Format start time
      const startTime = new Date(meeting.start);
      const timeStr = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      // Calculate time remaining until meeting
      const now = new Date();
      const minutesUntil = Math.round((startTime - now) / (1000 * 60));
      let timeRemaining = '';
      
      if (minutesUntil <= 0) {
        timeRemaining = '<span class="happening-now">Happening now</span>';
      } else if (minutesUntil < 60) {
        timeRemaining = `<span class="starting-soon">In ${minutesUntil} min${minutesUntil !== 1 ? 's' : ''}</span>`;
      } else {
        const hoursUntil = Math.floor(minutesUntil / 60);
        const minsRemaining = minutesUntil % 60;
        timeRemaining = `<span class="later-today">In ${hoursUntil} hr${hoursUntil !== 1 ? 's' : ''} ${minsRemaining > 0 ? `${minsRemaining} min` : ''}</span>`;
      }
      
      // Format end time if available
      let durationStr = '';
      if (meeting.end) {
        const endTime = new Date(meeting.end);
        const durationMins = Math.round((endTime - startTime) / (1000 * 60));
        if (durationMins < 60) {
          durationStr = `(${durationMins} min${durationMins !== 1 ? 's' : ''})`;
        } else {
          const durationHrs = Math.floor(durationMins / 60);
          const remainingMins = durationMins % 60;
          durationStr = `(${durationHrs} hr${durationHrs !== 1 ? 's' : ''} ${remainingMins > 0 ? `${remainingMins} min` : ''})`;
        }
      }
      
      // Create meeting HTML with richer details
      li.innerHTML = `
        <div class="meeting-time">
          <div class="start-time">${timeStr}</div>
          <div class="duration">${durationStr}</div>
          <div class="time-remaining">${timeRemaining}</div>
        </div>
        <div class="meeting-info">
          <div class="meeting-title">${meeting.title}</div>
          <div class="meeting-organizer">
            <span class="organizer-label">Organizer:</span>
            <span class="organizer-name">${meeting.organizer}</span>
          </div>
          ${meeting.attendees && typeof meeting.attendees === 'number' ? 
            `<div class="meeting-attendees">
              <span class="attendees-count">${meeting.attendees} attendee${meeting.attendees !== 1 ? 's' : ''}</span>
            </div>` : ''
          }
        </div>
        <div class="meeting-actions">
          <a href="${meeting.meetLink}" target="_blank" class="join-button">Join</a>
        </div>
      `;
      
      // Add to list
      this.elements.upcomingList.appendChild(li);
    });
    
    // Show the status section now that we have meetings
    if (this.elements.statusSection) {
      this.elements.statusSection.classList.remove('hidden');
    }
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
