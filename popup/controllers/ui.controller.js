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
      versionSpan: null,
      pollingError: null
    };
    
    // Audio for ringtone preview
    this.previewAudio = null;
    
    // UI state
    this.isLoading = false;
    this._hasCompletedFirstRun = false;
    
    // Bind methods
    this.init = this.init.bind(this);
    this.showSignedInUI = this.showSignedInUI.bind(this);
    this.showSignedOutUI = this.showSignedOutUI.bind(this);
    this.handleSignIn = this.handleSignIn.bind(this);
    this._handleFirstRunContinue = this._handleFirstRunContinue.bind(this);
  }
  
  /**
   * Initialize the UI controller
   */
  /**
   * Cache DOM elements for better performance
   */
  cacheElements() {
    // Helper function to safely get elements
    const getElement = (id) => {
      const el = document.getElementById(id);
      if (!el) {
        console.warn(`Element with id '${id}' not found`);
      }
      return el;
    };

    try {
      // Main sections
      this.elements.notSignedInSection = getElement('not-signed-in');
      this.elements.signedInSection = getElement('signed-in');
      this.elements.statusSection = getElement('status-section');
      
      // User info
      this.elements.userEmailSpan = getElement('user-email');
      
      // Buttons
      this.elements.signInButton = getElement('sign-in-button');
      this.elements.signOutButton = getElement('sign-out-button');
      this.elements.saveSettingsButton = getElement('save-settings');
      this.elements.testSoundButton = getElement('test-sound');
      
      // Status elements
      this.elements.statusIcon = getElement('status-icon');
      this.elements.statusText = getElement('status-text');
      
      // Meeting list
      this.elements.upcomingList = getElement('upcoming-list');
      this.elements.noMeetingsMsg = getElement('no-meetings-msg');
      
      // Settings
      this.elements.notificationTiming = getElement('notification-timing');
      this.elements.autoJoinCheckbox = getElement('auto-join');
      this.elements.ringtoneSelect = getElement('ringtone-select');
      
      // First run modal
      this.elements.firstRunModal = getElement('first-run-modal');
      this.elements.firstRunContinue = getElement('first-run-continue');
      
      // Version
      this.elements.versionSpan = getElement('version');
      
      console.log('DOM elements cached successfully');
    } catch (error) {
      console.error('Error caching DOM elements:', error);
      throw error;
    }
  }

  /**
   * Show error message to the user
   * @param {string} message - Error message to display
   */
  _showErrorUI(message) {
    console.error('Showing error UI:', message);
    try {
      // Show error state in the UI
      this.showErrorState(message);
    } catch (error) {
      console.error('Failed to show error UI:', error);
    }
  }

  /**
   * Check if this is the first run of the extension
   * @returns {Promise<boolean>} True if this is the first run
   * @private
   */
  async _checkFirstRun() {
    try {
      // First check our local state
      if (this._hasCompletedFirstRun !== undefined) {
        return !this._hasCompletedFirstRun;
      }
      
      // Then check settings service
      const settings = await settingsService.loadSettings();
      this._hasCompletedFirstRun = !settings.firstRun;
      
      console.log('First run check:', {
        settingsFirstRun: settings.firstRun,
        hasCompletedFirstRun: this._hasCompletedFirstRun
      });
      
      return settings.firstRun !== false; // Return true if firstRun is true or undefined
    } catch (error) {
      console.error('Error in _checkFirstRun:', error);
      errorTracker.captureException(error, { context: 'check_first_run' });
      return false; // Default to not first run on error
    }
  }

  /**
   * Handle the first run continue button click
   * @returns {Promise<boolean>} True if first run was completed successfully
   * @private
   */
  /**
   * Handle the first run continue button click
   * @returns {Promise<boolean>} True if first run was completed successfully
   * @private
   */
  async _handleFirstRunContinue() {
    console.log('=== FIRST RUN CONTINUE HANDLER STARTED ===');
    
    // Show loading state
    const continueButton = this.elements.firstRunContinue;
    if (!continueButton) {
      console.error('Continue button not found in elements');
      this._showErrorUI('UI Error: Could not find continue button');
      return false;
    }
    
    const originalText = continueButton.textContent;
    continueButton.disabled = true;
    continueButton.textContent = 'Getting Started...';
    
    try {
      // Show authenticating UI before starting the process
      this.showAuthenticatingUI();
      
      // Mark first run as completed in settings
      console.log('Marking first run as completed in settings...');
      await settingsService.saveSettings({ firstRun: false });
      this._hasCompletedFirstRun = true;
      
      // Hide the onboarding modal and show the main UI
      console.log('Hiding onboarding modal and showing main UI...');
      this._hideOnboardingModal();
      
      // Show the main UI sections
      if (this.elements.notSignedInSection) {
        this.elements.notSignedInSection.style.display = 'block';
      }
      
      // Add a small delay to ensure UI updates are processed
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log('Initiating sign-in flow...');
      
      try {
        // Call the sign-in handler directly
        await this.handleSignIn();
        return true;
      } catch (signInError) {
        console.error('Error during sign in from first run:', signInError);
        this._showSignInError(signInError.message || 'Failed to sign in');
        this.showSignedOutUI();
        return false;
      }
      
    } catch (error) {
      console.error('Error in first run continue handler:', error);
      errorTracker.captureException(error, { context: 'first_run_continue' });
      this._showErrorUI('Failed to complete setup. Please try again.');
      return false;
    } finally {
      // Always restore button state
      if (continueButton) {
        continueButton.disabled = false;
        continueButton.textContent = originalText;
      }
    }
  }

  /**
   * Update the service status display in the UI
   * @param {Object} status - The service status object
   * @param {('active'|'inactive'|'starting')} [status.state] - Service state
   * @param {boolean} [status.isActive] - Legacy support - use 'state' instead
   * @param {string} [status.message] - Optional status message
   */
  updateServiceStatus({ state, isActive, message }) {
    try {
      // Handle legacy isActive parameter for backward compatibility
      if (state === undefined && isActive !== undefined) {
        state = isActive ? 'active' : 'inactive';
      }
      
      console.log(`Updating service status: state=${state}, message=${message || 'No message'}`);
      
      if (!this.elements.statusIcon || !this.elements.statusText) {
        console.warn('Status elements not found');
        return;
      }
      
      // Update status icon and text based on state
      switch (state) {
        case 'active':
          this.elements.statusIcon.className = 'status-icon active';
          this.elements.statusText.textContent = message || 'Calendar monitoring active';
          this.elements.statusText.title = 'Calendar monitoring is active and running';
          break;
          
        case 'starting':
          this.elements.statusIcon.className = 'status-icon starting';
          this.elements.statusText.textContent = message || 'Starting calendar monitoring...';
          this.elements.statusText.title = 'Calendar monitoring is starting up';
          break;
          
        case 'inactive':
        default:
          this.elements.statusIcon.className = 'status-icon inactive';
          this.elements.statusText.textContent = message || 'Calendar monitoring paused';
          this.elements.statusText.title = 'Calendar monitoring is not active';
      }
      
      // Show status section if it exists
      if (this.elements.statusSection) {
        this.elements.statusSection.style.display = 'block';
        
        // Add pulsing animation for starting state
        if (state === 'starting') {
          this.elements.statusSection.classList.add('status-starting');
        } else {
          this.elements.statusSection.classList.remove('status-starting');
        }
      }
      
    } catch (error) {
      console.error('Error updating service status:', error);
    }
  }
  
  /**
   * Update the trigger threshold display in the UI
   * @param {number} minutes - The trigger threshold in minutes
   */
  updateTriggerThreshold(minutes) {
    try {
      console.log(`Updating trigger threshold display to ${minutes} minutes`);
      
      // Try to find the element in this order:
      // 1. Cached element
      // 2. Direct DOM lookup
      // 3. Create it if needed
      let thresholdElement = this.elements?.triggerThreshold || 
                           document.getElementById('trigger-threshold');
      
      // If still not found, try to create it
      if (!thresholdElement) {
        console.log('Trigger threshold element not found in cache or DOM, attempting to create it...');
        
        // Find or create the polling info container
        let pollingInfo = document.querySelector('#polling-info');
        if (!pollingInfo) {
          const statusSection = document.getElementById('status-section');
          if (statusSection) {
            pollingInfo = document.createElement('div');
            pollingInfo.id = 'polling-info';
            pollingInfo.className = 'status-details';
            statusSection.appendChild(pollingInfo);
          }
        }
        
        if (pollingInfo) {
          // Create the threshold element
          thresholdElement = document.createElement('div');
          thresholdElement.id = 'trigger-threshold';
          thresholdElement.className = 'status-detail';
          pollingInfo.appendChild(thresholdElement);
          
          // Cache the element for future use
          if (!this.elements) this.elements = {};
          this.elements.triggerThreshold = thresholdElement;
          
          console.log('Created missing trigger threshold element');
        } else {
          console.warn('Could not find or create polling info container for trigger threshold');
          return; // Can't proceed without a parent element
        }
      }
      
      // Update the trigger threshold text
      let thresholdText = 'Notification timing: ';
      if (minutes <= 0) {
        thresholdText += 'At start time';
      } else if (minutes === 1) {
        thresholdText += '1 minute before';
      } else {
        thresholdText += `${minutes} minutes before`;
      }
      
      thresholdElement.textContent = thresholdText;
      
    } catch (error) {
      console.error('Error updating trigger threshold display:', error);
    }
  }
  
  /**
   * Update the last poll time display in the UI
   * @param {Date} lastPollTime - The timestamp of the last poll
   */
  updateLastPollTime(lastPollTime) {
    try {
      if (!lastPollTime) return;
      
      const timeString = lastPollTime.toLocaleTimeString();
      console.log(`Updating last poll time to: ${timeString}`);
      
      // Format the time as a relative string (e.g., "2 minutes ago")
      const now = new Date();
      const diffInMinutes = Math.floor((now - lastPollTime) / (1000 * 60));
      
      let displayText;
      if (diffInMinutes < 1) {
        displayText = 'Just now';
      } else if (diffInMinutes < 60) {
        displayText = `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;
      } else {
        displayText = `at ${timeString}`;
      }
      
      // Update the UI element if it exists
      const lastPollElement = document.getElementById('last-poll-time');
      if (lastPollElement) {
        lastPollElement.textContent = `Last checked: ${displayText}`;
      }
    } catch (error) {
      console.error('Error updating last poll time:', error);
      errorTracker.captureException(error, { context: 'update_last_poll_time' });
    }
  }
  
  /**
   * Update the polling interval display in the UI
   * @param {number} minutes - The polling interval in minutes
   */
  updatePollingInterval(minutes) {
    try {
      console.log(`Updating polling interval display to ${minutes} minutes`);
      
      // Find the polling info element
      const pollingInfo = this.elements.statusSection?.querySelector('#polling-info');
      if (!pollingInfo) {
        console.warn('Polling info element not found');
        return;
      }
      
      // Update the polling interval text
      let intervalText = 'Checking for updates: ';
      if (minutes <= 0) {
        intervalText += 'Disabled';
      } else if (minutes === 1) {
        intervalText += 'Every minute';
      } else {
        intervalText += `Every ${minutes} minutes`;
      }
      
      pollingInfo.textContent = intervalText;
      
    } catch (error) {
      console.error('Error updating polling interval display:', error);
    }
  }
  
  /**
   * Display meetings in the UI
   * @param {Array} meetings - Array of meeting objects to display
   */
  displayMeetings(meetings) {
    try {
      console.log('Displaying meetings:', meetings);
      
      // Get the meetings list container and no meetings message elements
      const meetingsList = this.elements.upcomingList;
      const noMeetingsMsg = this.elements.noMeetingsMsg;
      
      if (!meetingsList || !noMeetingsMsg) {
        console.error('Required DOM elements not found for displaying meetings');
        return;
      }
      
      // Clear existing meetings
      meetingsList.innerHTML = '';
      
      if (!meetings || !Array.isArray(meetings) || meetings.length === 0) {
        // No meetings to display
        noMeetingsMsg.classList.remove('hidden');
        return;
      }
      
      // Hide the no meetings message
      noMeetingsMsg.classList.add('hidden');
      
      // Sort meetings by start time (soonest first)
      const now = new Date();
      const sortedMeetings = [...meetings].sort((a, b) => 
        new Date(a.startTime) - new Date(b.startTime)
      );
      
      // Create and append meeting elements
      sortedMeetings.forEach(meeting => {
        if (!meeting || !meeting.summary) return;
        
        const meetingElement = document.createElement('div');
        meetingElement.className = 'meeting-item';
        
        // Format meeting time
        const startTime = new Date(meeting.startTime);
        const timeString = startTime.toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: true 
        });
        
        // Create meeting HTML
        meetingElement.innerHTML = `
          <div class="meeting-time">${timeString}</div>
          <div class="meeting-details">
            <div class="meeting-title">${meeting.summary || 'No title'}</div>
            ${meeting.location ? `<div class="meeting-location">${meeting.location}</div>` : ''}
          </div>
          ${meeting.hangoutLink ? `
            <a href="${meeting.hangoutLink}" target="_blank" class="join-button" title="Join meeting">
              Join
            </a>
          ` : ''}
        `;
        
        meetingsList.appendChild(meetingElement);
      });
      
      console.log(`Displayed ${sortedMeetings.length} meetings`);
      
    } catch (error) {
      console.error('Error displaying meetings:', error);
      this._showErrorUI('Failed to load meetings');
    }
  }
  
  /**
   * Clear any polling error messages
   */
  clearPollingError() {
    try {
      if (this.elements.pollingError) {
        this.elements.pollingError.classList.add('hidden');
      }
    } catch (error) {
      console.error('Error clearing polling error:', error);
    }
  }

  /**
   * Hide the onboarding modal and show the main UI
   * @private
   */
  _hideOnboardingModal() {
    console.log('Hiding onboarding modal...');
    
    // Function to completely remove the modal from the DOM
    const removeModal = (modal) => {
      if (modal && modal.parentNode) {
        console.log('Removing modal from DOM');
        modal.parentNode.removeChild(modal);
        return true;
      }
      return false;
    };
    
    // Try to remove the modal from the DOM first (most reliable way to hide it)
    let modalRemoved = false;
    if (this.elements.firstRunModal) {
      modalRemoved = removeModal(this.elements.firstRunModal);
    } else {
      console.warn('firstRunModal element not found in cache, searching in DOM');
      const modal = document.getElementById('first-run-modal');
      if (modal) {
        modalRemoved = removeModal(modal);
      } else {
        console.warn('Could not find first-run-modal in DOM');
      }
    }
    
    // If we couldn't remove it, try to hide it with CSS as fallback
    if (!modalRemoved && this.elements.firstRunModal) {
      console.log('Fallback: Hiding modal with CSS');
      const modal = this.elements.firstRunModal;
      modal.style.display = 'none';
      modal.style.visibility = 'hidden';
      modal.style.opacity = '0';
      modal.style.pointerEvents = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    
    // Show the main UI sections
    const showElement = (element) => {
      if (element) {
        element.classList.remove('hidden');
        element.style.display = '';
        element.style.visibility = '';
        element.style.opacity = '';
        element.setAttribute('aria-hidden', 'false');
      }
    };
    
    // Show all main UI sections
    [this.elements.statusSection, this.elements.signedInSection, this.elements.authSection].forEach(showElement);
    
    // Force a reflow to ensure styles are applied
    if (document.body) {
      void document.body.offsetHeight;
    }
    
    console.log('Onboarding modal hidden and main UI shown');
  }

  /**
   * Show the first run UI
   * @private
   */
  _showFirstRunUI() {
    if (this.elements.firstRunModal) {
      this.elements.firstRunModal.classList.remove('hidden');
    }
  }

  /**
   * Set up event listeners for UI elements
   */
  setupEventListeners() {
    console.log('Setting up event listeners...');
    
    try {
      // Sign In Button
      if (this.elements.signInButton) {
        this.elements.signInButton.addEventListener('click', () => this.handleSignIn());
      }
      
      // Sign Out Button
      if (this.elements.signOutButton) {
        this.elements.signOutButton.addEventListener('click', () => this.handleSignOut());
      }
      
      // Save Settings Button
      if (this.elements.saveSettingsButton) {
        this.elements.saveSettingsButton.addEventListener('click', () => this.handleSaveSettings());
      }
      
      // Test Sound Button
      if (this.elements.testSoundButton) {
        this.elements.testSoundButton.addEventListener('click', () => this.handleTestRingtone());
      }
      
      // First Run Continue Button - Use a bound method for better context handling
      if (this.elements.firstRunContinue) {
        console.log('Setting up first run continue button listener');
        // Remove any existing click listeners first
        const newButton = this.elements.firstRunContinue.cloneNode(true);
        this.elements.firstRunContinue.parentNode.replaceChild(newButton, this.elements.firstRunContinue);
        this.elements.firstRunContinue = newButton;
        
        // Add the click handler with proper error handling
        this.elements.firstRunContinue.addEventListener('click', async (e) => {
          console.log('First run continue button clicked');
          e.preventDefault();
          e.stopPropagation();
          
          try {
            // Disable button during processing
            this.elements.firstRunContinue.disabled = true;
            this.elements.firstRunContinue.textContent = 'Setting up...';
            
            // Call the correct method (note the underscore prefix)
            const success = await this._handleFirstRunContinue();
            
            if (!success) {
              throw new Error('Failed to complete first run setup');
            }
            
            // Hide the first run modal on success
            if (this.elements.firstRunModal) {
              this.elements.firstRunModal.classList.add('hidden');
            }
            
          } catch (error) {
            console.error('Error in first run continue handler:', error);
            
            // Show a more specific error message
            let errorMessage = 'Failed to continue. Please try again.';
            if (error.message.includes('permission') || error.message.includes('auth')) {
              errorMessage = 'Authentication failed. Please try signing in again.';
            }
            
            this._showErrorUI(errorMessage);
            
            // Re-enable the button
            if (this.elements.firstRunContinue) {
              this.elements.firstRunContinue.disabled = false;
              this.elements.firstRunContinue.textContent = 'Get Started';
            }
          }
        });
      } else {
        console.warn('First run continue button not found in DOM');
      }
      
      console.log('Event listeners set up successfully');
    } catch (error) {
      console.error('Error setting up event listeners:', error);
      this._showErrorUI('Failed to set up event listeners');
    }
  }

  /**
   * Update authentication status in the UI
   * @param {Object} status - Authentication status object
   * @param {boolean} status.isAuthenticated - Whether the user is authenticated
   * @param {string} [status.userEmail] - User's email if authenticated
   * @param {string} [status.error] - Error message if authentication failed
   */
  updateAuthStatus(status) {
    console.log('Updating auth status in UI:', status);
    
    try {
      if (status.isAuthenticated) {
        console.log('User is authenticated, showing signed-in UI');
        
        // Show signed in state and hide sign in section
        if (this.elements.signedInSection) {
          this.elements.signedInSection.style.display = 'block';
          this.elements.signedInSection.classList.remove('hidden');
        }
        if (this.elements.notSignedInSection) {
          this.elements.notSignedInSection.style.display = 'none';
          this.elements.notSignedInSection.classList.add('hidden');
        }
        
        // Update user email if provided
        const emailToShow = status.userEmail || (status.userInfo && status.userInfo.email);
        if (emailToShow && this.elements.userEmailSpan) {
          console.log('Updating user email in UI:', emailToShow);
          this.elements.userEmailSpan.textContent = emailToShow;
        }
        
        // Update status indicator
        if (this.elements.statusIcon) {
          this.elements.statusIcon.className = 'status-icon active';
        }
        if (this.elements.statusText) {
          this.elements.statusText.textContent = 'Connected to Google Calendar';
          this.elements.statusText.className = 'success';
        }
        
        // Ensure status section is visible
        if (this.elements.statusSection) {
          this.elements.statusSection.style.display = 'block';
        }
        
        // Refresh meetings list if we have the element
        if (this.elements.upcomingList) {
          console.log('Refreshing meetings list from updateAuthStatus');
          this.refreshMeetingsList().catch(err => {
            console.error('Error refreshing meetings:', err);
          });
        }
      } else {
        console.log('User is not authenticated, showing sign-in UI');
        
        // Show signed out state
        if (this.elements.signedInSection) {
          this.elements.signedInSection.style.display = 'none';
          this.elements.signedInSection.classList.add('hidden');
        }
        if (this.elements.notSignedInSection) {
          this.elements.notSignedInSection.style.display = 'block';
          this.elements.notSignedInSection.classList.remove('hidden');
        }
        
        // Update status indicator
        if (this.elements.statusIcon) {
          this.elements.statusIcon.className = 'status-icon inactive';
        }
        if (this.elements.statusText) {
          this.elements.statusText.textContent = 'Calendar monitoring paused';
          this.elements.statusText.className = '';
        }
        
        // Ensure status section is visible
        if (this.elements.statusSection) {
          this.elements.statusSection.style.display = 'block';
        }
        
        // Show error if present
        if (status.error) {
          console.error('Authentication error:', status.error);
          this._showErrorUI(status.error);
        }
      }
    } catch (error) {
      console.error('Error updating auth status UI:', error);
      this._showErrorUI('Error updating UI');
    }
  }

  /**
   * Initialize the UI controller
   */
  async init() {
    console.log('=== UI CONTROLLER INITIALIZATION STARTED ===');
    
    try {
      // Cache DOM elements
      console.log('Caching DOM elements...');
      this.cacheElements();
      
      // Set up event listeners
      console.log('Setting up event listeners...');
      this.setupEventListeners();
      
      // Load settings first to check first-run state
      console.log('Loading settings...');
      const settings = await settingsService.loadSettings();
      console.log('Loaded settings:', settings);
      
      // Update first-run state from settings
      this._hasCompletedFirstRun = settings.firstRun === false;
      console.log('First run state:', { 
        settingsFirstRun: settings.firstRun, 
        hasCompletedFirstRun: this._hasCompletedFirstRun 
      });
      
      // Check authentication status with the background script
      const authStatus = await this._checkAuthStatus();
      console.log('Auth status from background:', authStatus);
      
      // Initial UI state
      if (!this._hasCompletedFirstRun) {
        console.log('First run detected, showing welcome screen');
        this._showFirstRunUI();
      } else if (authStatus.isAuthenticated) {
        console.log('User is authenticated, showing main UI');
        this._hideOnboardingModal();
        await this.showSignedInUI();
      } else {
        console.log('User is not authenticated, showing sign-in UI');
        this._hideOnboardingModal();
        this.showSignedOutUI();
      }
      
      console.log('=== UI CONTROLLER INITIALIZATION COMPLETE ===');
    } catch (error) {
      console.error('Error initializing UI controller:', error);
      errorTracker.captureException(error, { context: 'ui_controller_init' });
      this._showErrorUI('Failed to initialize the extension. Please try refreshing the page.');
    }
  }
  
  /**
   * Show the signed out UI state
   */
  showSignedOutUI() {
    console.log('Showing signed out UI...');
    
    // Ensure elements are cached
    if (!this.elements.notSignedInSection || !this.elements.signedInSection) {
      console.warn('UI elements not properly initialized, re-caching...');
      this._cacheElements();
    }
    
    // Show not signed in section and hide signed in section
    if (this.elements.notSignedInSection) {
      this.elements.notSignedInSection.classList.remove('hidden');
    }
    
    if (this.elements.signedInSection) {
      this.elements.signedInSection.classList.add('hidden');
    }
    
    // Update status if elements exist
    if (this.elements.statusText) {
      this.elements.statusText.textContent = 'Not signed in';
    }
    
    if (this.elements.statusIcon) {
      this.elements.statusIcon.className = 'status-icon not-signed-in';
    }
    
    console.log('Signed out UI shown');
  }
  
  /**
   * Update user information in the UI
   * @param {Object} userInfo - User information object
   * @param {string} userInfo.email - User's email
   * @param {string} [userInfo.name] - User's name (optional)
   */
  updateUserInfo(userInfo) {
    if (!userInfo) return;
    
    console.log('Updating user info in UI:', userInfo);
    
    // Update email if available
    if (userInfo.email && this.elements.userEmailSpan) {
      this.elements.userEmailSpan.textContent = userInfo.email;
    }
    
    // Update any other user info as needed
    // Example: if (userInfo.name && this.elements.userNameSpan) {
    //   this.elements.userNameSpan.textContent = userInfo.name;
    // }
  }

  /**
   * Update the user email in the UI
   * @param {string} email - The user's email address
   * @private
   */
  _updateUserEmail(email) {
    if (!email) return;
    
    // Find the email display element if it exists
    const emailElement = this.elements.userEmailSpan || document.getElementById('user-email');
    
    if (emailElement) {
      emailElement.textContent = email;
      // Make sure the element is visible
      emailElement.style.display = 'inline';
    } else {
      console.warn('User email element not found in the DOM');
    }
  }
  
  /**
   * Helper to show an element
   * @param {HTMLElement} element - The element to show
   * @private
   */
  _showElement(element) {
    if (element) {
      element.style.display = 'block';
      element.style.visibility = 'visible';
      element.classList.remove('hidden');
    }
  }

  /**
   * Helper to hide an element
   * @param {HTMLElement} element - The element to hide
   * @private
   */
  /**
   * Helper to hide an element
   * @param {HTMLElement} element - The element to hide
   * @private
   */
  _hideElement(element) {
    if (element) {
      element.style.display = 'none';
      element.style.visibility = 'hidden';
      element.classList.add('hidden');
    }
  }

/**
 * Initialize the UI controller
 */
async init() {
  console.log('=== UI CONTROLLER INITIALIZATION STARTED ===');
  
  try {
    // Cache DOM elements
    console.log('Caching DOM elements...');
    this.cacheElements();
    
    // Set up event listeners
    console.log('Setting up event listeners...');
    this.setupEventListeners();
    
    // Load settings first to check first-run state
    console.log('Loading settings...');
    const settings = await settingsService.loadSettings();
    console.log('Loaded settings:', settings);
    
    // Update first-run state from settings
    this._hasCompletedFirstRun = settings.firstRun === false;
    console.log('First run state:', { 
      settingsFirstRun: settings.firstRun, 
      hasCompletedFirstRun: this._hasCompletedFirstRun 
    });
    
    // Check authentication status with the background script
    const authStatus = await this._checkAuthStatus();
    console.log('Auth status from background:', authStatus);
    
    // Initial UI state
    if (!this._hasCompletedFirstRun) {
      console.log('First run detected, showing welcome screen');
      this._showFirstRunUI();
    } else if (authStatus.isAuthenticated) {
      console.log('User is authenticated, showing main UI');
      this._hideOnboardingModal();
      await this.showSignedInUI();
    } else {
      console.log('User is not authenticated, showing sign-in UI');
      this._hideOnboardingModal();
      this.showSignedOutUI();
    }
    
    console.log('=== UI CONTROLLER INITIALIZATION COMPLETE ===');
  } catch (error) {
    console.error('Error initializing UI controller:', error);
    errorTracker.captureException(error, { context: 'ui_controller_init' });
    this._showErrorUI('Failed to initialize the extension. Please try refreshing the page.');
  }
}

/**
 * Show the signed out UI state
 */
showSignedOutUI() {
  console.log('Showing signed out UI...');
  
  // Ensure elements are cached
  if (!this.elements.notSignedInSection || !this.elements.signedInSection) {
    console.warn('UI elements not properly initialized, re-caching...');
    this._cacheElements();
  }
  
  // Show not signed in section and hide signed in section
  if (this.elements.notSignedInSection) {
    this.elements.notSignedInSection.classList.remove('hidden');
  }
  
  if (this.elements.signedInSection) {
    this.elements.signedInSection.classList.add('hidden');
  }
  
  // Update status if elements exist
  if (this.elements.statusText) {
    this.elements.statusText.textContent = 'Not signed in';
  }
  
  if (this.elements.statusIcon) {
    this.elements.statusIcon.className = 'status-icon not-signed-in';
  }
  
  console.log('Signed out UI shown');
}

/**
 * Update the user email in the UI
 * @param {string} email - The user's email address
 * @private
 */
_updateUserEmail(email) {
  if (!email) return;
  
  // Find the email display element if it exists
  const emailElement = this.elements.userEmailSpan || document.getElementById('user-email');
  
  if (emailElement) {
    emailElement.textContent = email;
    // Make sure the element is visible
    emailElement.style.display = 'inline';
  } else {
    console.warn('User email element not found in the DOM');
  }
}

/**
 * Helper to show an element
 * @param {HTMLElement} element - The element to show
 * @private
 */
_showElement(element) {
  if (element) {
    element.style.display = 'block';
    element.style.visibility = 'visible';
    element.classList.remove('hidden');
  }
}

/**
 * Helper to hide an element
 * @param {HTMLElement} element - The element to hide
 * @private
 */
_hideElement(element) {
  if (element) {
    element.style.display = 'none';
    element.style.visibility = 'hidden';
    element.classList.add('hidden');
  }
}

/**
 * Show the signed in UI state
 * @param {Object} [userInfo] - Optional user info to display
 */
  async showSignedInUI(userInfo) {
    console.log('=== SHOW SIGNED IN UI ===', { userInfo });
    
    try {
      // First, ensure we have the latest auth status
      console.log('Fetching latest auth status...');
      const authStatus = await this._checkAuthStatus();
      console.log('Current auth status:', authStatus);
      
      // If we have explicit userInfo, use it, otherwise use what's in authStatus
      const effectiveUserInfo = userInfo || (authStatus && authStatus.userInfo);
      console.log('Effective user info:', effectiveUserInfo);
      
      // Double check authentication state
      const isAuthenticated = authStatus && authStatus.isAuthenticated;
      console.log('Is authenticated:', isAuthenticated);
      
      if (!isAuthenticated) {
        console.log('User is not authenticated, showing sign-in UI');
        this.showSignedOutUI();
        return;
      }
      
      console.log('Updating UI for authenticated user...');
      
      // Update UI state first to show we're signed in
      if (this.elements.signedInSection) {
        console.log('Showing signed in section');
        this.elements.signedInSection.style.display = 'block';
        this.elements.signedInSection.classList.remove('hidden');
      }
      
      if (this.elements.notSignedInSection) {
        console.log('Hiding not signed in section');
        this.elements.notSignedInSection.style.display = 'none';
        this.elements.notSignedInSection.classList.add('hidden');
      }
      
      // Update status text
      if (this.elements.statusText) {
        console.log('Updating status text');
        this.elements.statusText.textContent = 'Connected to Google Calendar';
        this.elements.statusText.className = 'success';
      }
      
      if (this.elements.statusIcon) {
        console.log('Updating status icon');
        this.elements.statusIcon.className = 'status-icon active';
      }
      
      // Display user email if available
      if (effectiveUserInfo && effectiveUserInfo.email) {
        console.log('Displaying user email from effectiveUserInfo:', effectiveUserInfo.email);
        if (this.elements.userEmailSpan) {
          this.elements.userEmailSpan.textContent = effectiveUserInfo.email;
        }
      } else if (authStatus && authStatus.userEmail) {
        console.log('Displaying user email from authStatus:', authStatus.userEmail);
        if (this.elements.userEmailSpan) {
          this.elements.userEmailSpan.textContent = authStatus.userEmail;
        }
      } else {
        // If we don't have user info but are authenticated, try to get it
        console.log('No user info available, attempting to fetch...');
        try {
          const userData = await this._fetchUserInfo();
          console.log('Fetched user data:', userData);
          if (userData && userData.email) {
            console.log('Fetched user email:', userData.email);
            if (this.elements.userEmailSpan) {
              this.elements.userEmailSpan.textContent = userData.email;
            }
          }
        } catch (fetchError) {
          console.warn('Could not fetch user info:', fetchError);
          // Even if we can't get the email, continue with the UI update
        }
      }
      
      // Force hide the onboarding modal if it's still visible
      if (this.elements.firstRunModal && 
          this.elements.firstRunModal.style.display !== 'none') {
        console.log('Hiding onboarding modal from showSignedInUI');
        this._hideOnboardingModal();
      }
      
      // Load settings
      console.log('Loading settings...');
      await this._loadAndDisplaySettings();
      
      // Refresh meetings list
      console.log('Refreshing meetings list...');
      await this.refreshMeetingsList();
      
      console.log('UI update complete');
    } catch (error) {
      console.error('Error in showSignedInUI:', error);
      this._showErrorUI('Error updating UI. Please refresh the page.');
    }
  }
  
  /**
   * Refresh the meetings list from the background script
   * @returns {Promise<void>}
   * @private
   */
  async refreshMeetingsList() {
    console.log('Refreshing meetings list...');
    
    try {
      // Show loading state if available
      if (this.loadingView && this._showElement) {
        this._showElement(this.loadingView);
      }
      
      console.log('Sending refreshMeetings message to background script...');
      
      // Request a refresh from the background script
      const response = await chrome.runtime.sendMessage({ 
        action: 'refreshMeetings' 
      });
      
      console.log('Received response from background script:', response);
      
      if (!response) {
        throw new Error('No response received from background script');
      }
      
      if (response.success) {
        console.log('Meetings refreshed successfully');
        // The background script will send a status update with the new meetings
      } else {
        const errorMessage = response.error || 'Unknown error';
        console.error('Failed to refresh meetings:', errorMessage);
        
        if (response.error === 'auth_error') {
          this._showErrorUI('Authentication error. Please sign in again.');
        } else if (response.error === 'api_error') {
          this._showErrorUI('Error connecting to Google Calendar. Please try again later.');
        } else {
          this._showErrorUI('Failed to refresh meetings. Please try again.');
        }
      }
    } catch (error) {
      console.error('Error in refreshMeetingsList:', error);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        chromeError: chrome.runtime.lastError
      });
      
      let errorMessage = 'Error refreshing meetings. ';
      
      if (chrome.runtime.lastError) {
        errorMessage += `[${chrome.runtime.lastError.message}]`;
      } else if (error.message) {
        errorMessage += error.message;
      }
      
      this._showErrorUI(errorMessage);
    } finally {
      // Hide loading state
      if (this._hideElement) {
        this._hideElement(this.loadingView);
      } else {
        console.error('_hideElement method is not available');
      }
    }
  }
  
  /**
   * Show the authenticating UI state
   */
  showAuthenticatingUI() {
    if (this.elements.notSignedInSection) this.elements.notSignedInSection.style.display = 'block';
    if (this.elements.signedInSection) this.elements.signedInSection.style.display = 'none';
    
    if (this.elements.statusText) {
      this.elements.statusText.textContent = 'Authenticating...';
    }
    
    if (this.elements.statusIcon) {
      this.elements.statusIcon.className = 'status-icon loading';
    }
    
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
   * Alias for showAuthenticatingUI for backward compatibility
   * @private
   */
  _showAuthenticatingUI() {
    this.showAuthenticatingUI();
  }
  
  /**
   * Show sign in error message
   * @param {string} message - Error message to display
   * @private
   */
  _showSignInError(message) {
    console.error('Sign in error:', message);
    this._showErrorUI(message);
  }
  
  /**
   * Show error state in the UI
   * @param {string} message - Error message to display
   */
  showErrorState(message) {
    this._showErrorUI(message);
  }
  
  /**
   * Handle the sign in button click
   */
  // Check authentication status with background script
  async _checkAuthStatus() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error checking auth status:', chrome.runtime.lastError);
            resolve({ isAuthenticated: false, userInfo: null });
            return;
          }
          
          if (response && response.success) {
            console.log('Auth status from background:', response);
            resolve({
              isAuthenticated: response.isAuthenticated || false,
              userInfo: response.userInfo || null
            });
          } else {
            console.error('Failed to get auth status:', response && response.error);
            resolve({ isAuthenticated: false, userInfo: null });
          }
        });
      } catch (error) {
        console.error('Error in _checkAuthStatus:', error);
        resolve({ isAuthenticated: false, userInfo: null });
      }
    });
  }
  
  // Handle sign in
  async handleSignIn() {
    console.log('=== HANDLE SIGN IN ===');
    
    // Prevent multiple sign-in attempts
    if (this.isSigningIn) {
      console.log('Sign in already in progress');
      return;
    }
    
    this.isSigningIn = true;
    
    try {
      // Show authenticating state
      this._showAuthenticatingUI();
      
      console.log('Starting sign in process...');
      
      // Reset any previous errors
      this.elements.statusText.textContent = 'Signing in...';
      
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'signIn' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error during sign in:', chrome.runtime.lastError);
            resolve({ 
              success: false, 
              error: {
                message: chrome.runtime.lastError.message || 'Unknown error during sign in',
                details: chrome.runtime.lastError
              }
            });
            return;
          }
          
          if (!response) {
            console.error('No response from background script');
            resolve({ 
              success: false, 
              error: { 
                message: 'No response from extension service',
                details: 'The extension background service did not respond'
              } 
            });
            return;
          }
          
          resolve(response);
        });
      });
      
      console.log('Sign in result:', result);
      
      if (result && result.success) {
        console.log('Sign in successful, showing signed-in UI...');
        await this.showSignedInUI(result.userInfo);
        console.log('Sign in flow completed successfully');
        return;
      }
      
      // Handle error case
      const error = result?.error || { message: 'Authentication failed' };
      console.error('❌ Sign in failed:', error);
      
      // Log the error
      errorTracker.captureException(new Error(error.message), { 
        context: 'sign_in',
        details: error.details,
        isAuthenticated: false
      });
      
      // Show appropriate error message
      let errorMessage = 'Authentication failed';
      const errorMessageLower = error.message.toLowerCase();
      
      if (errorMessageLower.includes('popup_closed') || errorMessageLower.includes('user_cancelled')) {
        errorMessage = 'Sign in was canceled';
      } else if (errorMessageLower.includes('access_denied') || errorMessageLower.includes('permission_denied')) {
        errorMessage = 'Access was denied. Please check your permissions.';
      } else if (errorMessageLower.includes('network') || errorMessageLower.includes('offline')) {
        errorMessage = 'Network error. Please check your internet connection.';
      } else if (errorMessageLower.includes('invalid_client') || errorMessageLower.includes('unauthorized_client')) {
        errorMessage = 'Authentication configuration error. Please contact support.';
      }
      
      this._showSignInError(errorMessage);
      this.showSignedOutUI();
      
    } catch (error) {
      console.error('❌ Unexpected error during sign in:', error);
      
      // Log the error
      errorTracker.captureException(error, { 
        context: 'sign_in_unhandled',
        isAuthenticated: false
      });
      
      this._showSignInError('An unexpected error occurred. Please try again.');
      this.showSignedOutUI();
      
    } finally {
      this.isSigningIn = false;
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
    console.log('=== HANDLE FIRST RUN CONTINUE ===');
    
    // Prevent multiple clicks
    if (this.isHandlingFirstRun) {
      console.log('First run handling already in progress');
      return;
    }
    
    this.isHandlingFirstRun = true;
    
    try {
      // Update button state
      if (this.elements.firstRunContinue) {
        this.elements.firstRunContinue.disabled = true;
        this.elements.firstRunContinue.textContent = 'Getting Started...';
      }
      
      console.log('Completing first run in settings...');
      
      // Mark first run as complete
      await settingsService.completeFirstRun();
      console.log('First run marked as complete');
      
      // Hide the onboarding modal
      this._hideOnboardingModal();
      console.log('Onboarding modal hidden');
      
      // Start authentication flow
      console.log('Starting authentication flow...');
      await this.handleSignIn();
      
    } catch (error) {
      console.error('❌ Error in handleFirstRunContinue:', error);
      errorTracker.captureException(error, { context: 'first_run_continue' });
      
      // Show error but keep the modal open so user can retry
      this.showErrorState('Failed to complete setup. Please try again.');
      
      // Re-enable the button
      if (this.elements.firstRunContinue) {
        this.elements.firstRunContinue.disabled = false;
        this.elements.firstRunContinue.textContent = 'Get Started';
      }
      
    } finally {
      this.isHandlingFirstRun = false;
    }
  }
  
  // PRIVATE METHODS
  
  /**
   * Check if we should show the first run modal
   * @returns {Promise<boolean>} - True if first run modal should be shown
   * @private
   */
  async _shouldShowFirstRun() {
    try {
      const settings = await settingsService.loadSettings();
      return settings?.firstRun !== false; // Default to true if not set
    } catch (error) {
      console.error('Error checking first run status:', error);
      return true; // Default to showing first run on error
    }
  }

  /**
   * Cache DOM elements
   * @returns {boolean} - Always returns true to ensure initialization can continue
   * @private
   */
  _cacheElements() {
    // Only initialize elements if it doesn't exist
    if (!this.elements) {
      this.elements = {};
    }
    
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
    this.elements.triggerThreshold = getElement('trigger-threshold');
    
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
      
      // Enhanced event listener with proper async/await and error handling
      this.elements.firstRunContinue.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('First run continue button clicked!');
        
        try {
          await this.handleFirstRunContinue();
        } catch (error) {
          console.error('Error in first run continue handler:', error);
          this.showErrorState('Failed to start setup. Please try again.');
          
          // Re-enable the button if there was an error
          if (this.elements.firstRunContinue) {
            this.elements.firstRunContinue.disabled = false;
            this.elements.firstRunContinue.textContent = 'Get Started';
          }
        }
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
      const userInfo = await authService.getUserInfo();
      if (userInfo && userInfo.email) {
        if (this.elements.userEmailSpan) {
          this.elements.userEmailSpan.textContent = userInfo.email;
          this.elements.userEmailSpan.title = userInfo.email; // Add tooltip with full email
          console.log('User email displayed:', userInfo.email);
        } else {
          console.warn('User email element not found in DOM');
        }
      } else {
        console.warn('No user info available to display');
        // Fallback to a default or placeholder if needed
        if (this.elements.userEmailSpan) {
          this.elements.userEmailSpan.textContent = 'user@example.com';
        }
      }
    } catch (error) {
      console.error('Error displaying user email:', error);
      errorTracker.logError('Failed to display user email', { error });
      
      // Fallback to a default or placeholder
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
