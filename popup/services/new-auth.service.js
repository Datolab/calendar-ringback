/**
 * New Authentication Service for Calendar Ringback
 * A clean implementation with robust state management and persistence
 */

import errorTracker from '../../utils/error-tracking.js';

class NewAuthService {
  constructor() {
    this.STORAGE_KEY = 'auth_state_v2';
    this.TOKEN_REFRESH_ALARM = 'calendarRingbackTokenRefresh_v2';
    
    // State
    this.state = {
      token: null,
      tokenExpiry: null,
      userInfo: null,
      isAuthenticating: false,
      lastError: null
    };
    
    // Bind methods
    this.initialize = this.initialize.bind(this);
    this.signIn = this.signIn.bind(this);
    this.signOut = this.signOut.bind(this);
    this.getUserInfo = this.getUserInfo.bind(this);
    this._loadState = this._loadState.bind(this);
    this._saveState = this._saveState.bind(this);
    this._handleAlarm = this._handleAlarm.bind(this);
    
    // Set up alarm listener
    chrome.alarms.onAlarm.addListener(this._handleAlarm);
  }
  
  /**
   * Initialize the auth service
   */
  async initialize() {
    try {
      await this._loadState();
      console.log('[AUTH] Service initialized', { 
        hasToken: !!this.state.token,
        isTokenValid: this.state.token && this.state.tokenExpiry > Date.now()
      });
      return true;
    } catch (error) {
      console.error('[AUTH] Initialization failed:', error);
      errorTracker.captureException(error, { context: 'auth_initialize' });
      return false;
    }
  }
  
  /**
   * Load auth state from storage
   * @private
   */
  async _loadState() {
    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      if (data[this.STORAGE_KEY]) {
        const savedState = data[this.STORAGE_KEY];
        
        // Only use the token if it's still valid
        if (savedState.token) {
          const isTokenValid = savedState.tokenExpiry > Date.now();
          
          if (isTokenValid) {
            this.state = {
              ...this.state,
              token: savedState.token,
              tokenExpiry: savedState.tokenExpiry,
              userInfo: savedState.userInfo || null
            };
            console.log('[AUTH] Loaded valid auth state');
          } else {
            console.log('[AUTH] Token expired, clearing saved state');
            await this.signOut();
          }
        }
      }
      return true;
    } catch (error) {
      console.error('[AUTH] Failed to load auth state:', error);
      errorTracker.captureException(error, { context: 'load_auth_state' });
      return false;
    }
  }
  
  /**
   * Save auth state to storage
   * @private
   */
  async _saveState() {
    try {
      const stateToSave = {
        token: this.state.token,
        tokenExpiry: this.state.tokenExpiry,
        userInfo: this.state.userInfo
      };
      
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: stateToSave
      });
      
      // Also save to sync storage if available
      if (chrome.storage.sync) {
        try {
          await chrome.storage.sync.set({
            [this.STORAGE_KEY]: stateToSave
          });
        } catch (syncError) {
          console.warn('[AUTH] Could not save to sync storage:', syncError);
        }
      }
      
      console.log('[AUTH] Auth state saved');
      return true;
    } catch (error) {
      console.error('[AUTH] Failed to save auth state:', error);
      errorTracker.captureException(error, { context: 'save_auth_state' });
      return false;
    }
  }
  
  /**
   * Sign in the user
   * @param {boolean} interactive - Whether to show UI if needed
   */
  async signIn(interactive = true) {
    if (this.state.isAuthenticating) {
      console.log('[AUTH] Sign in already in progress');
      return { success: false, error: 'authentication_in_progress' };
    }
    
    this.state.isAuthenticating = true;
    this.state.lastError = null;
    
    try {
      // First check if we have a valid token
      if (this.state.token && this.state.tokenExpiry > Date.now() + 30000) {
        console.log('[AUTH] Using existing valid token');
        
        // Verify the token is still good
        try {
          const userInfo = await this.getUserInfo();
          if (userInfo) {
            return { 
              success: true, 
              userInfo,
              fromCache: true 
            };
          }
        } catch (verifyError) {
          console.warn('[AUTH] Token verification failed, will refresh:', verifyError);
        }
      }
      
      // Get a new token
      console.log('[AUTH] Getting new token...');
      const token = await this._getToken(interactive);
      
      if (!token) {
        throw new Error('No token received from authentication');
      }
      
      // Update state
      this.state.token = token;
      this.state.tokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour default
      
      // Get user info
      const userInfo = await this.getUserInfo();
      
      // Schedule token refresh
      this._scheduleTokenRefresh();
      
      // Save state
      await this._saveState();
      
      console.log('[AUTH] Sign in successful');
      return { 
        success: true, 
        userInfo,
        fromCache: false 
      };
      
    } catch (error) {
      console.error('[AUTH] Sign in failed:', error);
      this.state.lastError = error.message;
      errorTracker.captureException(error, { context: 'sign_in' });
      
      // Clear invalid token state
      if (error.message.includes('invalid_token') || 
          error.message.includes('token_expired')) {
        await this.signOut();
      }
      
      return { 
        success: false, 
        error: error.message || 'sign_in_failed' 
      };
    } finally {
      this.state.isAuthenticating = false;
    }
  }
  
  /**
   * Get an authentication token
   * @private
   */
  async _getToken(interactive = true) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!token) {
          return reject(new Error('No token received'));
        }
        resolve(token);
      });
    });
  }
  
  /**
   * Sign out the current user
   */
  async signOut() {
    try {
      // Clear the token from Chrome's identity cache
      if (this.state.token) {
        await new Promise((resolve) => {
          chrome.identity.removeCachedAuthToken(
            { token: this.state.token },
            resolve
          );
        });
      }
      
      // Clear our state
      this.state.token = null;
      this.state.tokenExpiry = null;
      this.state.userInfo = null;
      this.state.lastError = null;
      
      // Clear storage
      await chrome.storage.local.remove(this.STORAGE_KEY);
      if (chrome.storage.sync) {
        await chrome.storage.sync.remove(this.STORAGE_KEY);
      }
      
      // Clear any pending refresh
      chrome.alarms.clear(this.TOKEN_REFRESH_ALARM);
      
      console.log('[AUTH] User signed out');
      return { success: true };
      
    } catch (error) {
      console.error('[AUTH] Sign out failed:', error);
      errorTracker.captureException(error, { context: 'sign_out' });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Get user profile information
   */
  async getUserInfo() {
    if (!this.state.token) {
      throw new Error('Not authenticated');
    }
    
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${this.state.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      this.state.userInfo = await response.json();
      await this._saveState();
      
      return this.state.userInfo;
      
    } catch (error) {
      console.error('[AUTH] Failed to get user info:', error);
      
      // If the token is invalid, clear it
      if (error.message.includes('401') || 
          error.message.toLowerCase().includes('invalid token')) {
        await this.signOut();
      }
      
      throw error;
    }
  }
  
  /**
   * Schedule token refresh
   * @private
   */
  _scheduleTokenRefresh() {
    if (!this.state.tokenExpiry) return;
    
    // Refresh 5 minutes before expiry
    const refreshTime = this.state.tokenExpiry - (5 * 60 * 1000);
    const timeUntilRefresh = Math.max(0, refreshTime - Date.now());
    
    // Clear any existing alarm
    chrome.alarms.clear(this.TOKEN_REFRESH_ALARM);
    
    // Set new alarm
    if (timeUntilRefresh > 0) {
      chrome.alarms.create(this.TOKEN_REFRESH_ALARM, {
        when: Date.now() + timeUntilRefresh
      });
      console.log(`[AUTH] Token refresh scheduled in ${Math.floor(timeUntilRefresh / 1000)}s`);
    }
  }
  
  /**
   * Handle alarm events
   * @private
   */
  async _handleAlarm(alarm) {
    if (alarm.name === this.TOKEN_REFRESH_ALARM) {
      console.log('[AUTH] Token refresh alarm triggered');
      
      try {
        // Try to get a new token non-interactively
        const token = await this._getToken(false);
        
        if (token) {
          // Update token and schedule next refresh
          this.state.token = token;
          this.state.tokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour
          await this._saveState();
          this._scheduleTokenRefresh();
          console.log('[AUTH] Token refreshed successfully');
        }
      } catch (error) {
        console.error('[AUTH] Token refresh failed:', error);
        // Don't clear the token here - it might still be valid
      }
    }
  }
  
  /**
   * Get the current authentication status
   */
  getAuthStatus() {
    const isAuthenticated = !!this.state.token && 
                          this.state.tokenExpiry > Date.now();
    
    return {
      isAuthenticated,
      userInfo: this.state.userInfo,
      token: isAuthenticated ? this.state.token : null,
      error: this.state.lastError
    };
  }
}

// Export as singleton
const authService = new NewAuthService();
export default authService;
