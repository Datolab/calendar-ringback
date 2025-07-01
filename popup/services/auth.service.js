/**
 * Authentication Service for Calendar Ringback
 * Handles authentication for both Chrome and Edge browsers
 */

import edgeAuthService from './edge-auth.service.js';
import errorTracker from '../../utils/error-tracking.js';
import { getBrowserConfig } from '../../config.js';

class AuthService {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.isAuthenticating = false;
    this.userInfo = null;
    this.initialized = false;
    this.TOKEN_REFRESH_ALARM = 'calendarRingbackTokenRefresh';
    this.STORAGE_KEY = 'auth_state';
    this.isEdge = this._detectEdge();
    
    // Set up alarm listener for token refresh
    chrome.alarms.onAlarm.addListener(this._handleAlarm.bind(this));
    
    // Start initialization
    this._loadState();
  }

  /**
   * Initialize the auth service
   * @returns {Promise<boolean>} True if initialization was successful
   */
  async _loadState() {
    try {
      console.log('[AUTH] Loading auth state from storage...');
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      if (data[this.STORAGE_KEY]) {
        const { token, tokenExpiry, userInfo } = data[this.STORAGE_KEY];
        this.token = token || null;
        this.tokenExpiry = tokenExpiry || null;
        this.userInfo = userInfo || null;
        
        console.log('[AUTH] Loaded auth state from storage:', {
          hasToken: !!token,
          tokenExpiry: tokenExpiry ? new Date(tokenExpiry).toISOString() : null,
          hasUserInfo: !!userInfo
        });
        
        return true;
      }
      console.log('[AUTH] No auth state found in storage');
      return false;
    } catch (error) {
      console.error('[AUTH] Error loading auth state:', error);
      errorTracker.captureException(error, { context: 'load_auth_state' });
      return false;
    }
  }

  async _saveState() {
    try {
      const state = {
        token: this.token,
        tokenExpiry: this.tokenExpiry,
        userInfo: this.userInfo
      };
      
      console.log('[AUTH] Saving auth state:', {
        hasToken: !!this.token,
        tokenExpiry: this.tokenExpiry ? new Date(this.tokenExpiry).toISOString() : null,
        hasUserInfo: !!this.userInfo
      });
      
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: state
      });
      
      console.log('[AUTH] Auth state saved successfully');
      return true;
    } catch (error) {
      console.error('[AUTH] Error saving auth state:', error);
      errorTracker.captureException(error, { context: 'save_auth_state' });
      return false;
    }
  }

  async initialize() {
    if (this.initialized) {
      console.log('[AUTH] Auth service already initialized');
      return true;
    }
    
    try {
      console.log('[AUTH] Initializing auth service...');
      
      // Load any saved state
      const stateLoaded = await this._loadState();
      console.log('[AUTH] State loaded:', stateLoaded);
      
      // Check if we have a valid token
      if (this.token && this.tokenExpiry && this.tokenExpiry > Date.now()) {
        console.log('[AUTH] Using existing valid token');
        // Schedule the next token refresh
        this._scheduleTokenRefresh();
        this.initialized = true;
        return true;
      }
      
      // If we have an expired token, try to refresh it
      if (this.token) {
        console.log('[AUTH] Token expired or invalid, attempting refresh');
        try {
          await this.refreshToken(false); // Non-interactive refresh
          this.initialized = true;
          return true;
        } catch (error) {
          console.log('[AUTH] Token refresh failed, clearing state');
          await this.signOut();
          this.initialized = true;
          return false;
        }
      }
      
      console.log('[AUTH] No existing auth state found');
      this.initialized = true;
      return false;
    } catch (error) {
      console.error('[AUTH] Initialization error:', error);
      errorTracker.captureException(error, { context: 'auth_initialization' });
      this.initialized = false;
      return false;
    }
  }

  /**
   * Detect if we're running in Microsoft Edge
   * @private
   */
  _detectEdge() {
    return navigator.userAgent.includes('Edg/');
  }

  /**
   * Handle alarm events
   * @private
   */
  _handleAlarm(alarm) {
    if (alarm.name === this.TOKEN_REFRESH_ALARM) {
      console.log('[AUTH] Token refresh alarm triggered');
      this.refreshToken(true).catch(console.error);
    }
  }

  /**
   * Get the current authentication status
   * @returns {Promise<boolean>} True if authenticated, false otherwise
   */
  async isAuthenticated() {
    try {
      // If we're already in the process of authenticating, wait for it to complete
      if (this.isAuthenticating) {
        console.log('[AUTH] Authentication already in progress, waiting...');
        // Wait for authentication to complete with a timeout
        const startTime = Date.now();
        while (this.isAuthenticating && (Date.now() - startTime) < 30000) { // 30s timeout
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return !!this.token;
      }
      
      // Ensure we've loaded the latest state
      if (!this.initialized) {
        await this.initialize();
      }
      
      // If we have a valid token, we're authenticated
      if (this.token && this.tokenExpiry && this.tokenExpiry > Date.now()) {
        console.log('[AUTH] Valid token found, user is authenticated');
        return true;
      }
      
      // If we have a token but it's expired, try to refresh it non-interactively
      if (this.token) {
        console.log('[AUTH] Token expired, attempting non-interactive refresh');
        try {
          await this.refreshToken(false); // Non-interactive refresh
          return true;
        } catch (error) {
          console.log('[AUTH] Non-interactive token refresh failed, user needs to sign in');
          return false;
        }
      }
      
      console.log('[AUTH] No valid token found, user is not authenticated');
      return false;
    } catch (error) {
      console.error('[AUTH] Error checking authentication status:', error);
      errorTracker.captureException(error, { context: 'check_auth_status' });
      return false;
    }
  }

  /**
   * Get an authentication token
   * @param {boolean} interactive - Whether to show the auth UI if needed
   * @returns {Promise<string>} The OAuth token
   */
  async getToken(interactive = true) {
    if (this.token && (!this.tokenExpiry || this.tokenExpiry > Date.now())) {
      return this.token;
    }
    
    return this.refreshToken(interactive);
  }

  /**
   * Refresh the authentication token
   * @param {boolean} interactive - Whether to show the auth UI if needed
   * @returns {Promise<string>} The new token
   */
  async refreshToken(interactive = true) {
    // Create a unique identifier for this refresh attempt for better debugging
    const refreshId = Math.random().toString(36).substr(2, 9);
    console.log(`[AUTH][${refreshId}] Starting token refresh (interactive: ${interactive})`);
    
    // If already authenticating, wait for it to complete
    if (this.isAuthenticating) {
      console.log(`[AUTH][${refreshId}] Authentication already in progress, waiting...`);
      const startTime = Date.now();
      const timeout = 30000; // 30 seconds
      
      // Wait for authentication to complete or timeout
      while (this.isAuthenticating && (Date.now() - startTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // If we have a token, return it
      if (this.token) {
        console.log(`[AUTH][${refreshId}] Using existing authentication`);
        return this.token;
      }
      
      // If we timed out, log it and reset the flag
      if (this.isAuthenticating) {
        console.warn(`[AUTH][${refreshId}] Authentication wait timed out after ${timeout}ms`);
        this.isAuthenticating = false;
      }
    }

    // Set the authenticating flag
    this.isAuthenticating = true;
    let authSuccessful = false;
    
    try {
      console.log(`[AUTH][${refreshId}] Starting new authentication flow...`);
      
      let token;
      if (this.isEdge) {
        console.log(`[AUTH][${refreshId}] Using Edge authentication flow`);
        token = await edgeAuthService.authenticate();
      } else {
        console.log(`[AUTH][${refreshId}] Using Chrome authentication flow`);
        token = await this._chromeAuthFlow(interactive);
      }
      
      if (!token) {
        throw new Error('No token received from authentication flow');
      }
      
      console.log(`[AUTH][${refreshId}] Token received, updating state...`);
      this.token = token;
      this.tokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour from now
      
      console.log(`[AUTH][${refreshId}] Token refresh successful, new expiry:`, 
        new Date(this.tokenExpiry).toISOString());
      
      // Save the updated state
      await this._saveState();
      this._scheduleTokenRefresh();
      
      authSuccessful = true;
      return this.token;
      
    } catch (error) {
      console.error(`[AUTH][${refreshId}] Token refresh failed:`, error);
      
      // Clear invalid state on failure
      this.token = null;
      this.tokenExpiry = null;
      this.userInfo = null;
      
      try {
        await this._saveState();
      } catch (saveError) {
        console.error(`[AUTH][${refreshId}] Failed to save state after error:`, saveError);
      }
      
      // Log the error
      errorTracker.captureException(error, { 
        context: 'token_refresh',
        interactive,
        hasToken: !!this.token,
        tokenExpiry: this.tokenExpiry,
        refreshId
      });
      
      throw error;
      
    } finally {
      console.log(`[AUTH][${refreshId}] Authentication process completed. Success: ${authSuccessful}`);
      // Always reset the flag, even if there was an error
      this.isAuthenticating = false;
      
      // Double-check that the flag was actually reset
      if (this.isAuthenticating) {
        console.error(`[AUTH][${refreshId}] WARNING: isAuthenticating flag was not properly reset!`);
        this.isAuthenticating = false; // Force reset
      }
    }
  }

  /**
   * Handle Chrome authentication flow
   * @private
   */
  async _chromeAuthFlow(interactive) {
    console.log(`[AUTH] Starting Chrome auth flow (interactive: ${interactive})`);
    
    // Check if we're running in a context where chrome.identity is available
    if (!chrome.identity || !chrome.identity.getAuthToken) {
      const errorMsg = 'Chrome identity API is not available in this context';
      console.error('[AUTH]', errorMsg);
      throw new Error(errorMsg);
    }
    
    try {
      // First, try to get the token non-interactively to avoid popup blockers
      if (interactive) {
        try {
          console.log('[AUTH] Attempting non-interactive auth first...');
          const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: false }, (token) => {
              if (chrome.runtime.lastError) {
                console.log('[AUTH] Non-interactive auth failed (expected if not signed in):', 
                  chrome.runtime.lastError.message);
                resolve(null);
              } else {
                console.log('[AUTH] Successfully obtained token non-interactively');
                resolve(token);
              }
            });
          });
          
          if (token) {
            return token;
          }
        } catch (nonInteractiveError) {
          console.log('[AUTH] Non-interactive auth attempt failed, will try interactive:', 
            nonInteractiveError.message);
        }
      }
      
      // If we need interactive auth or non-interactive failed, try interactive
      if (interactive) {
        console.log('[AUTH] Starting interactive auth flow...');
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError;
              console.error('[AUTH] Interactive auth error:', error);
              
              // Handle popup blocked by the browser
              if (error.message && error.message.includes('popup_closed_by_user')) {
                return reject(new Error('Authentication popup was blocked. Please allow popups for this site and try again.'));
              }
              
              // Handle user cancellation
              if (error.message && (error.message.includes('canceled') || 
                                   error.message.includes('user_cancelled'))) {
                return reject(new Error('Authentication was cancelled by user'));
              }
              
              // For other errors, include more context
              return reject(new Error(`Authentication failed: ${error.message || 'Unknown error'}`));
            }
            
            if (!token) {
              console.error('[AUTH] No token returned from Chrome auth');
              return reject(new Error('No authentication token received'));
            }
            
            console.log('[AUTH] Successfully obtained token interactively');
            resolve(token);
          });
        });
        
        return token;
      }
      
      // If we get here and don't have a token, and we're not interactive, fail
      throw new Error('Authentication required. Please sign in.');
      
    } catch (error) {
      console.error('[AUTH] Chrome auth flow failed:', error);
      
      // Add more context to the error if possible
      if (error.message && error.message.includes('OAuth2 request failed')) {
        // This often happens when the user needs to re-authenticate
        console.log('[AUTH] OAuth2 request failed - user may need to re-authenticate');
      }
      
      throw error;
    }
  }

  /**
   * Schedule token refresh
   * @private
   */
  _scheduleTokenRefresh() {
    if (!this.tokenExpiry) return;
    
    // Refresh 5 minutes before expiry
    const refreshTime = this.tokenExpiry - (5 * 60 * 1000);
    const timeUntilRefresh = Math.max(0, refreshTime - Date.now());
    
    // Clear any existing alarm
    chrome.alarms.clear(this.TOKEN_REFRESH_ALARM);
    
    // Set new alarm
    chrome.alarms.create(this.TOKEN_REFRESH_ALARM, {
      when: Date.now() + timeUntilRefresh
    });
  }

  /**
   * Sign in the user
   * @returns {Promise<{token: string, userInfo: object}>}
   */
  async signIn() {
    console.log('[AUTH] Sign in requested');
    
    if (this.isAuthenticating) {
      console.log('[AUTH] Sign in already in progress, waiting...');
      const startTime = Date.now();
      
      // Wait for any in-progress authentication to complete
      while (this.isAuthenticating && (Date.now() - startTime) < 30000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // If we have a valid token, return it
      if (this.token) {
        console.log('[AUTH] Using existing authentication');
        return { 
          token: this.token, 
          userInfo: this.userInfo || await this.getUserInfo() 
        };
      }
      
      // If still authenticating, throw an error
      if (this.isAuthenticating) {
        console.warn('[AUTH] Authentication wait timed out');
        this.isAuthenticating = false; // Reset flag on timeout
        throw new Error('Authentication timed out');
      }
    }
    
    console.log('[AUTH] Starting new sign in flow...');
    this.isAuthenticating = true;
    
    try {
      console.log('[AUTH] Refreshing token...');
      const token = await this.refreshToken(true);
      
      if (!token) {
        throw new Error('No token received from authentication');
      }
      
      console.log('[AUTH] Token received, getting user info...');
      // Get user info after successful sign in
      const userInfo = await this.getUserInfo();
      
      // Save the updated state
      console.log('[AUTH] Saving auth state...');
      await this._saveState();
      
      console.log('[AUTH] Sign in successful');
      return { token, userInfo };
    } catch (error) {
      console.error('[AUTH] Sign in failed:', error);
      
      // Clear any partial state on failure
      this.token = null;
      this.tokenExpiry = null;
      this.userInfo = null;
      
      try {
        await this._saveState();
      } catch (saveError) {
        console.error('[AUTH] Failed to save state after error:', saveError);
      }
      
      // Log the error
      errorTracker.captureException(error, { 
        context: 'sign_in',
        hasToken: !!this.token,
        hasUserInfo: !!this.userInfo
      });
      
      throw error;
    } finally {
      console.log('[AUTH] Sign in process completed');
      this.isAuthenticating = false;
    }
  }

  /**
   * Sign out the current user
   */
  async signOut() {
    if (!this.token) return;
    
    try {
      if (this.isEdge) {
        // Edge doesn't support identity.removeCachedAuthToken
        // Just clear our local state
        this.token = null;
        this.tokenExpiry = null;
        this.userInfo = null;
      } else {
        // For Chrome, remove the cached token
        await new Promise((resolve) => {
          chrome.identity.removeCachedAuthToken({ token: this.token }, () => {
            this.token = null;
            this.tokenExpiry = null;
            this.userInfo = null;
            resolve();
          });
        });
      }
      
      // Clear any pending refresh
      chrome.alarms.clear(this.TOKEN_REFRESH_ALARM);
      
      console.log('[AUTH] User signed out');
    } catch (error) {
      console.error('[AUTH] Error during sign out:', error);
      errorTracker.captureException(error, { context: 'sign_out' });
      throw error;
    }
  }

  /**
   * Get user profile information
   * @returns {Promise<Object>} User profile information
   */
  async getUserInfo() {
  try {
    console.log('[AUTH] Fetching user info...');
    
    // If we already have user info, return it
    if (this.userInfo) {
      return this.userInfo;
    }
    
    // Get a valid token
    const token = await this.getToken();
    
    // Fetch user profile from Google API
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.statusText}`);
    }
    
    this.userInfo = await response.json();
    console.log('[AUTH] User info fetched:', this.userInfo);
    return this.userInfo;
    
  } catch (error) {
    console.error('[AUTH] Error fetching user info:', error);
    errorTracker.captureException(error, { context: 'get_user_info' });
    throw error;
  }
}
}

// Export as singleton
const authService = new AuthService();
export default authService;
