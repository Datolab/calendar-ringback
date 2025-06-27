/**
 * Authentication Service for Calendar Ringback
 * Handles all authentication flows and token management
 */

import errorTracker from '../../utils/error-tracking.js';

class AuthService {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.isAuthenticating = false;
    this.userInfo = null;
    this.TOKEN_REFRESH_ALARM = 'calendarRingbackTokenRefresh';
    
    // Detect if we're in service worker context
    this.isServiceWorker = (typeof window === 'undefined');
    console.log(`[AUTH] Running in ${this.isServiceWorker ? 'service worker' : 'window'} context`);
    
    // Set up alarm listener for token refresh
    chrome.alarms.onAlarm.addListener(alarm => {
      if (alarm.name === this.TOKEN_REFRESH_ALARM) {
        console.log('[AUTH] Token refresh alarm triggered');
        
        if (this.isServiceWorker) {
          console.log('[AUTH] In service worker context, using storage-based refresh strategy');
          
          // Instead of messaging, set a flag in storage that the UI can check
          chrome.storage.local.set({
            'token_needs_refresh': true,
            'token_refresh_requested': Date.now()
          }, () => {
            console.log('[AUTH] Token refresh request stored in local storage');
            // Storage-based approach is more reliable with service workers
            // The popup will check this flag when it opens and refresh if needed
          });
          
          // Also try the direct refresh as fallback
          this._tryServiceWorkerRefresh();
        } else {
          // In regular window context, refresh directly
          this.refreshToken(true).catch(err => {
            console.warn('[AUTH] Auto token refresh failed:', err);
          });
        }
      } else if (alarm.name === 'calendarRingbackTest') {
        console.log('[AUTH] Test alarm fired successfully!');
      }
    });
    
    // Schedule periodic checks for refresh requests from storage
    // This helps ensure refresh happens even if messaging fails
    if (!this.isServiceWorker) {
      this._setupStorageRefreshCheck();
    }
  }

  /**
   * Initialize the authentication service
   * @returns {Promise<boolean>} True if authenticated
   */
  async initialize() {
    try {
      const storedData = await this._getStoredAuthData();
      this.token = storedData.oauth_token || null;
      this.tokenExpiry = storedData.token_expiry || null;
      this.isAuthenticating = storedData.authInProgress || false;
      
      // Log initialization status
      console.log('[AUTH] AuthService initialized:', { 
        hasToken: !!this.token,
        tokenExpiry: this.tokenExpiry ? new Date(this.tokenExpiry).toLocaleTimeString() : 'none',
        msUntilExpiry: this.tokenExpiry ? (this.tokenExpiry - Date.now()) : 'N/A'
      });
      
      // Check if we have a token but it's about to expire
      if (this.token && this.tokenExpiry) {
        const timeToExpiry = this.tokenExpiry - Date.now();
        
        // Schedule refresh if token is valid
        if (timeToExpiry > 0) {
          console.log(`[AUTH] Token expires in ${Math.round(timeToExpiry/1000)} seconds, scheduling refresh`);
          this._scheduleTokenRefresh();
        } else {
          console.log('[AUTH] Token already expired during initialization');
          // We'll try to use it anyway and let the API report if it fails
        }
      }
      
      return !!this.token;
    } catch (error) {
      errorTracker.logError('Failed to initialize AuthService', { error });
      return false;
    }
  }

  /**
   * Check if the user is authenticated
   * @returns {Promise<boolean>} True if the user has a valid token
   */
  async isAuthenticated(silentFail = false) {
    try {
      // If we already have a valid token in memory, use it
      if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        if (!silentFail) console.log('[AUTH] Using valid token from memory');
        return true;
      }
      
      // Check chrome.storage for a token
      const authData = await this._getStoredAuthData();
      
      if (authData && authData.oauth_token) {
        if (!silentFail) console.log('[AUTH] Found token in storage');
        this.token = authData.oauth_token;
        this.tokenExpiry = authData.token_expiry || null;
        
        // Even with expired token, consider the user authenticated
        // This ensures UI shows as logged in while we attempt refresh
        
        // Check if token is expired or expiring soon
        if (this.tokenExpiry) {
          const expiryTime = new Date(this.tokenExpiry).getTime();
          const currentTime = Date.now();
          const msUntilExpiry = expiryTime - currentTime;
          const minutesUntilExpiry = Math.round(msUntilExpiry / 60000);
          
          if (!silentFail) {
            if (msUntilExpiry > 0) {
              console.log(`[AUTH] Token valid, expires in ${minutesUntilExpiry} minutes`);
            } else {
              console.log(`[AUTH] Token expired ${Math.abs(minutesUntilExpiry)} minutes ago, but treating as authenticated while refresh happens`);
            }
          }
          
          // If token is expired or about to expire (< 5 minutes), schedule refresh
          if (msUntilExpiry < 300000) {
            if (!silentFail) console.log('[AUTH] Token needs refresh, scheduling in background');
            // Schedule refresh but don't block authentication check
            this._scheduleTokenRefresh(1); // Try refresh in 1 minute
            
            // For immediate refresh (if UI is available)
            if (!this.isServiceWorker) {
              this.refreshToken(false).catch(e => {
                if (!silentFail) console.warn('[AUTH] Background refresh failed:', e);
              });
            }
          }
        }
        
        // Even with an expired token, keep the user logged in while refresh happens
        return true;
      }
      
      return false;
    } catch (error) {
      if (!silentFail) console.error('[AUTH] Error checking authentication status:', error);
      return false;
    }
  }

  /**
   * Sign in the user using OAuth
   * @returns {Promise<string>} Access token
   */
  async signIn() {
    try {
      if (this.isAuthenticating) {
        console.log('Authentication already in progress');
        return null;
      }

      this.isAuthenticating = true;
      await this._setAuthInProgress(true);
      
      // Clear all cached tokens before attempting authentication
      console.log('Clearing all cached auth tokens...');
      await this._clearCachedTokens();
      
      // Update status in UI
      const statusText = document.getElementById('status-text');
      if (statusText) {
        statusText.textContent = 'Authenticating...';
      }
      
      // Go directly to WebAuthFlow for authentication
      console.log('Using WebAuthFlow for authentication...');
      if (statusText) statusText.textContent = 'Launching auth window...';
      
      try {
        // Launch WebAuthFlow directly - this is the most reliable method
        const token = await this._directWebAuthFlow();
        
        if (token) {
          console.log('WebAuthFlow authentication successful');
          if (statusText) statusText.textContent = 'Authentication successful';
          
          await this._storeToken(token);
          
          // Update auth status
          this.isAuthenticating = false;
          await this._setAuthInProgress(false);
          
          // Notify background script that auth was successful
          chrome.runtime.sendMessage({ action: 'authenticationUpdated', status: true });
          
          return token;
        } else {
          throw new Error('WebAuthFlow returned empty token');
        }
      } catch (error) {
        console.error('WebAuthFlow authentication failed:', error);
        
        // Reset auth status
        this.isAuthenticating = false;
        await this._setAuthInProgress(false);
        
        // Update UI if possible
        if (statusText) statusText.textContent = 'Authentication failed';
        
        throw error;
      }
    } catch (error) {
      errorTracker.logError('Authentication error', { error });
      console.error('Authentication error:', error);
      
      // Reset auth status
      this.isAuthenticating = false;
      await this._setAuthInProgress(false);
      
      // Update UI if possible
      const statusText = document.getElementById('status-text');
      if (statusText) statusText.textContent = 'Authentication error';
      
      throw error;
    }
  }

  /**
   * Sign the user out
   * @returns {Promise<void>}
   */
  async signOut() {
    try {
      // Clear token data from storage
      await this._clearStoredToken();
      
      // Clear cached tokens from chrome.identity
      await this._clearCachedTokens();
      
      // Clear in-memory token data
      this.token = null;
      this.tokenExpiry = null;
      this.userInfo = null;
      
      // Notify background script
      chrome.runtime.sendMessage({ action: 'authenticationUpdated', status: false });
      
      console.log('Sign out complete');
    } catch (error) {
      errorTracker.logError('Sign out failed', { error });
      throw error;
    }
  }

  /**
   * Refresh the current token
   * @param {boolean} interactive - Whether to show UI if refresh fails
   * @returns {Promise<string>} A new valid token
   */
  async refreshToken(interactive = false) {
    console.log(`[AUTH] Refreshing token at ${new Date().toLocaleTimeString()} (interactive: ${interactive})`);
    
    try {
      // First try silently (non-interactive)
      console.log('[AUTH] Attempting silent token refresh');
      
      // Clear tokens first to ensure we get a fresh one
      await this._clearCachedTokens();
      await this._clearStoredToken();
      
      try {
        // Try silent refresh first
        const token = await this._getAuthToken(false);
        await this._storeToken(token);
        console.log('[AUTH] Silent refresh succeeded');
        return token;
      } catch (error) {
        console.warn('[AUTH] Silent refresh failed:', error);
        
        // Check for client ID issues
        this._diagnoseOAuthErrors(error);
        
        // Only try interactive as fallback if allowed
        if (interactive) {
          console.log('[AUTH] Falling back to interactive refresh');
          try {
            const token = await this._getAuthToken(true);
            await this._storeToken(token);
            console.log('[AUTH] Interactive refresh succeeded');
            return token;
          } catch (err) {
            console.error('[AUTH] Interactive refresh failed:', err);
            this._diagnoseOAuthErrors(err);
            throw err;
          }
        } else {
          // Re-throw if we're not allowed to do interactive refresh
          throw silentError;
        }
      }
    } catch (error) {
      console.error('[AUTH] Token refresh failed completely:', error);
      
      // Safely log error without using window object (compatible with service worker)
      try {
        console.error('Token refresh error details:', JSON.stringify(error));
      } catch (e) {
        // In case error can't be stringified
        console.error('Token refresh error (could not stringify details)');
      }
      
      // Don't use errorTracker in service worker context
      // errorTracker may be using window which doesn't exist in service workers
      throw error;
    }
  }

  /**
  /**
   * Get the user's Google profile information
   * @param {boolean} silentFail - Whether to silently fail without logging errors
   * @returns {Promise<Object>} User profile data
   */
  async getUserInfo(silentFail = false) {
    try {
      // Return cached user info if available
      if (this.userInfo) {
        return this.userInfo;
      }
      
      // Get the token directly - more reliable than isAuthenticated()
      // which sometimes returns false even when a token exists
      let token;
      try {
        token = await new Promise(resolve => {
          chrome.storage.local.get('oauth_token', result => resolve(result && result.oauth_token));
        });
      } catch (e) {
        if (!silentFail) console.warn('Error checking token in storage:', e);
      }
      
      if (!token) {
        if (!silentFail) {
          console.log('No authentication token available for getUserInfo');
        }
        return { email: 'user@example.com' };
      }
      
      const url = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        // Handle 401 unauthorized (expired token)
        if (response.status === 401) {
          console.log('Token expired (401), attempting to refresh...');
          const newToken = await this.refreshToken();
          
          // Retry the request with the new token
          const retryResponse = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${newToken}`
            }
          });
          
          if (!retryResponse.ok) {
            if (!silentFail) {
              console.warn(`Failed to fetch user info after token refresh: ${retryResponse.status}`);
            }
            return { email: 'user@example.com' };
          }
          
          this.userInfo = await retryResponse.json();
          return this.userInfo;
        }
        
        if (!silentFail) {
          console.warn(`Failed to fetch user info: ${response.status}`);
        }
        return { email: 'user@example.com' };
      }
      
      this.userInfo = await response.json();
      return this.userInfo;
    } catch (error) {
      // Only log the error if not in silent mode
      if (!silentFail) {
        // Use console.warn instead of error tracker to reduce noise
        console.warn('Error fetching user info:', error.message);
      }
      
      // Fallback: try to get profile from chrome identity API
      try {
        return await this._getProfileUserInfo();
      } catch (fallbackError) {
        if (!silentFail) {
          console.warn('Fallback user info also failed');
        }
        return { email: 'user@example.com' }; // Default fallback
      }
    }
  }

  /**
   * Get the authentication token for private use
   * @returns {string|null} The current token
   */
  getToken() {
    return this.token;
  }

  // PRIVATE METHODS

  /**
   * Get stored authentication data from chrome.storage
   * @returns {Promise<Object>} Stored auth data
   * @private
   */
  async _getStoredAuthData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['oauth_token', 'token_expiry', 'authInProgress'], (data) => {
        resolve(data || {});
      });
    });
  }

  /**
   * Store a token in chrome.storage and update the state
   * @param {string} token - The OAuth token
   * @param {number} expiresIn - Token expiry in seconds
   * @returns {Promise<void>}
   * @private
   */
  async _storeToken(token, expiresIn = 3600) {
    try {
      // Calculate expiry time
      const expiryTime = Date.now() + (expiresIn * 1000);
      const expiryDate = new Date(expiryTime);
      
      console.log(`[AUTH] Storing token with expiry: ${expiryDate.toLocaleString()}`);
      
      // Update memory cache
      this.token = token;
      this.tokenExpiry = expiryTime;
      
      // Store in chrome.storage
      await new Promise(resolve => {
        chrome.storage.local.set({
          oauth_token: token,
          token_expiry: expiryTime
        }, () => {
          resolve();
        });
      });
      
      // Schedule token refresh
      if (token) {
        this._scheduleTokenRefresh(expiresIn);
      }
      
      return true;
    } catch (error) {
      console.error('[AUTH] Failed to store token:', error);
      return false;
    }
  }
  
  /**
   * Clear stored token data from chrome.storage.local
   * @private
   * @returns {Promise<boolean>} Success status
   */
  async _clearStoredToken() {
    try {
      console.log('[AUTH] Clearing stored token data');
      
      // Clear memory cache
      this.token = null;
      this.tokenExpiry = null;
      
      // Clear chrome.storage
      await new Promise(resolve => {
        chrome.storage.local.remove([
          'oauth_token',
          'token_expiry',
          'token_needs_refresh',
          'token_refresh_requested',
          'token_refresh_time'
        ], () => {
          if (chrome.runtime.lastError) {
            console.warn('[AUTH] Error clearing token storage:', chrome.runtime.lastError);
          }
          resolve();
        });
      });
      
      // Clear any scheduled token refresh alarms
      await new Promise(resolve => {
        chrome.alarms.clear(this.TOKEN_REFRESH_ALARM, wasCleared => {
          console.log(`[AUTH] Token refresh alarm${wasCleared ? '' : ' not'} cleared`);
          resolve();
        });
      });
      
      return true;
    } catch (error) {
      console.error('[AUTH] Failed to clear token storage:', error);
      return false;
    }
  }

  /**
   * Get an auth token from chrome.identity
   * @param {boolean} interactive - Whether to show UI if needed
   * @returns {Promise<string>} An auth token
   * @private
   */
  async _getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
      console.log(`[AUTH] Requesting auth token with interactive=${interactive}`);
      
      // First check if we're in a service worker context where chrome.identity might behave differently
      const isServiceWorker = (typeof window === 'undefined');
      console.log(`[AUTH] Context: ${isServiceWorker ? 'service worker' : 'window'}`);
      
      // For service worker context, use a different approach that works better with Web Application client IDs
      if (isServiceWorker) {
        console.log('[AUTH] Using launchWebAuthFlow for service worker context');
        this._getAuthTokenWithWebAuthFlow(interactive).then(resolve).catch(reject);
        return;
      }
      
      // Use standard getAuthToken for UI context
      const tokenOptions = { interactive };
      
      try {
        chrome.identity.getAuthToken(tokenOptions, (token) => {
          if (chrome.runtime.lastError) {
            console.error('[AUTH] Auth token error:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          
          if (token) {
            console.log('[AUTH] Auth token obtained successfully');
            resolve(token);
          } else {
            console.error('[AUTH] No auth token returned');
            reject(new Error('No auth token returned'));
          }
        });
      } catch (e) {
        console.error('[AUTH] Exception during getAuthToken:', e);
        reject(e);
      }
    });
  }

  /**
   * Get auth token using chrome.identity.getAuthToken - recommended for Manifest V3
   * @returns {Promise<string>} The OAuth token
   * @private
   */
  async _directWebAuthFlow() {
    return new Promise((resolve, reject) => {
      console.log('Using chrome.identity.getAuthToken for authentication...');
      
      try {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
          if (chrome.runtime.lastError) {
            console.error('getAuthToken error:', chrome.runtime.lastError);
            
            // Provide more detailed debug information
            this._diagnoseOAuthErrors(chrome.runtime.lastError);
            
            reject(chrome.runtime.lastError);
            return;
          }
          
          if (!token) {
            console.error('No token returned from getAuthToken');
            reject(new Error('No token returned from getAuthToken'));
            return;
          }
          
          console.log('Token obtained successfully via getAuthToken');
          resolve(token);
        });
      } catch (error) {
        console.error('Fatal error in getAuthToken:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Diagnose common OAuth errors with helpful messages
   * @param {Error} error - The error to diagnose
   * @private
   */
  _diagnoseOAuthErrors(error) {
    const errorMsg = error.message || '';
    
    if (errorMsg.includes('OAuth2 not granted or revoked')) {
      console.log('DIAGNOSIS: User needs to grant permission or has revoked access');
      console.log('ACTION: Try clearing Chrome cache and cookies for Google accounts');
    } else if (errorMsg.includes('Function not implemented')) {
      console.log('DIAGNOSIS: Chrome identity API not working properly in this context');
      console.log('ACTION: Ensure you\'re using a Chrome Extension client ID in manifest.json');
    } else if (errorMsg.includes('invalid_client')) {
      console.log('DIAGNOSIS: Client ID is invalid or not registered properly');
      console.log('ACTION: Verify client ID in Google Cloud Console and manifest.json match');
    } else if (errorMsg.includes('unauthorized_client')) {
      console.log('DIAGNOSIS: Client not authorized for this authentication method');
      console.log('ACTION: Ensure client ID type is "Chrome App" in Google Cloud Console');
    } else if (errorMsg.includes('access_denied')) {
      console.log('DIAGNOSIS: User declined permission');
    } else if (errorMsg.includes('popup_closed')) {
      console.log('DIAGNOSIS: User closed authentication window');
    } else {
      console.log('DIAGNOSIS: Unrecognized OAuth error:', errorMsg);
      console.log('ACTION: Check Google Cloud Console configuration');
    }
  }
  
  /**
   * Legacy WebAuth Flow implementation - kept for reference
   * @returns {Promise<string>} The OAuth token
   * @private
   * @deprecated Use _directWebAuthFlow instead
   */
  async _launchWebAuthFlow() {
    console.warn('_launchWebAuthFlow is deprecated, use _directWebAuthFlow instead');
    return this._directWebAuthFlow();
  }
  
  /**
   * Continue authentication with WebAuthFlow after getAuthToken fails
   * @param {string} clientId - OAuth client ID
   * @param {string} extensionId - Chrome extension ID
   * @param {Function} resolve - Promise resolve function
   * @param {Function} reject - Promise reject function
   * @private 
   */
  _continueWithWebAuthFlow(clientId, extensionId, resolve, reject) {
    // Start of the method - make sure it's being called
    console.log('_continueWithWebAuthFlow method called with clientId:', clientId);
    try {
      console.log('_continueWithWebAuthFlow starting...');
      
      // Get the redirect URL from Chrome
      const redirectURL = chrome.identity.getRedirectURL();
      console.log('Chrome Identity Redirect URL:', redirectURL);
      
      if (!redirectURL) {
        console.error('Could not get redirect URL');
        reject(new Error('Could not get redirect URL'));
        return;
      }
      
      // Redirect URL is now properly configured in Google Cloud Console
      console.log('Using redirect URL:', redirectURL);
      
      
      // Create auth URL - using token response_type (no client_secret needed)
      const scopes = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email';
      
      // Adding state parameter to help with debugging
      const state = 'calendarringback_' + Date.now();
      
      const authURL = 'https://accounts.google.com/o/oauth2/auth' +
        '?client_id=' + encodeURIComponent(clientId) +
        '&response_type=token' +
        '&redirect_uri=' + encodeURIComponent(redirectURL) +
        '&scope=' + encodeURIComponent(scopes) +
        '&state=' + encodeURIComponent(state) +
        '&prompt=consent';
      
      console.log('WebAuthFlow URL:', authURL);
      console.log('Expected redirect URI pattern: Should match Chrome extension OAuth client');
      
      // Display helpful debug info in UI
      const statusText = document.getElementById('status-text');
      if (statusText) {
        statusText.textContent = 'Launching auth window...';
      }
      
      console.log('About to call launchWebAuthFlow with interactive=true...');
      
      // Give time for console logs to appear
      // Immediately launch without setTimeout to avoid delays
      console.log('Now executing launchWebAuthFlow...');
      chrome.identity.launchWebAuthFlow({
        url: authURL,
        interactive: true
      }, (responseUrl) => {
          if (chrome.runtime.lastError) {
            console.error('WebAuthFlow error:', chrome.runtime.lastError);
            
            // For Chrome Extension OAuth clients, we know we need to use the OOB approach
            console.log('WebAuthFlow failed, trying OOB fallback approach...');
            
            // Try fallback to a different auth approach
            try {
              this._tryAlternativeAuth(clientId, scopes).then(resolve).catch(reject);
            } catch (error) {
              console.error('Alternative auth error:', error);
              reject(error);
            }
            return;
          }
        
        if (!responseUrl) {
          console.error('No response URL returned from WebAuthFlow');
          if (statusText) {
            statusText.textContent = 'Auth failed - no response';
          }
          reject(new Error('No response URL returned from WebAuthFlow'));
          return;
        }
        
        console.log('WebAuthFlow completed with response URL');
        
        try {
          // Extract the token from the response URL
          const url = new URL(responseUrl);
          console.log('WebAuthFlow response URL parsed successfully');
          
          const hash = url.hash.substring(1); // Remove the # character
          console.log('WebAuthFlow hash component:', hash);
          
          const params = new URLSearchParams(hash);
          const token = params.get('access_token');
          const expiresIn = params.get('expires_in');
          const error = params.get('error');
          
          if (error) {
            console.error('Error in auth response:', error);
            if (statusText) {
              statusText.textContent = `Auth error: ${error}`;
            }
            reject(new Error(`Auth response error: ${error}`));
            return;
          }
          
          if (!token) {
            console.error('No token found in the response');
            if (statusText) {
              statusText.textContent = 'Auth failed - no token';
            }
            reject(new Error('No token found in the response'));
            return;
          }
          
          console.log('Token successfully extracted from WebAuthFlow response');
          if (statusText) {
            statusText.textContent = 'Authenticated!';
          }
          resolve(token);
        } catch (error) {
          console.error('Error parsing WebAuthFlow response:', error);
          if (statusText) {
            statusText.textContent = 'Auth error - parsing failed';
          }
          reject(error);
        }
      });
  } catch (error) {
    console.error('Fatal error in _continueWithWebAuthFlow:', error);
    reject(error);
  }
}

  /**
   * Remove a cached auth token
   * @param {string} token - The token to remove
   * @returns {Promise<void>}
   * @private
   */
  async _removeCachedAuthToken(token) {
    return new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        console.log('Removed cached auth token');
        resolve();
      });
    });
  }

  /**
   * Get user profile information from Chrome identity API (fallback)
   * @returns {Promise<Object>} User profile information
   * @private
   */
  async _getProfileUserInfo() {
    return new Promise((resolve, reject) => {
      chrome.identity.getProfileUserInfo((userInfo) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        
        if (userInfo && userInfo.email) {
          resolve(userInfo);
        } else {
          reject(new Error('No user info available'));
        }
      });
    });
  }
  
  /**
   * Set authentication in progress status in chrome.storage
   * @param {boolean} inProgress - Whether authentication is in progress
   * @returns {Promise<void>}
   * @private
   */
  async _setAuthInProgress(inProgress) {
    return chrome.storage.local.set({ authInProgress: inProgress });
  }
  
  /**
   * Clear all cached authentication tokens
   * @returns {Promise<void>}
   * @private
   */
  async _clearCachedTokens() {
    return new Promise((resolve) => {
      // Remove cached tokens from chrome.identity
      chrome.identity.clearAllCachedAuthTokens(() => {
        console.log('All cached auth tokens cleared');
        resolve();
      });
    });
  }
  
  /**
   * Get an auth token using launchWebAuthFlow which works better in service worker context
   * with Web Application client IDs
   * @param {boolean} interactive - Whether to allow user interaction
   * @returns {Promise<string>} Auth token
   * @private
   */
  async _getAuthTokenWithWebAuthFlow(interactive = false) {
    return new Promise((resolve, reject) => {
      try {
        // Get client ID from manifest
        const manifest = chrome.runtime.getManifest();
        const clientId = manifest?.oauth2?.client_id;
        
        if (!clientId) {
          return reject(new Error('No OAuth client ID found in manifest'));
        }
        
        // Define OAuth scope
        const scopes = manifest.oauth2.scopes.join(' ');
        
        // Create auth URL
        const redirectURL = chrome.identity.getRedirectURL();
        console.log('[AUTH] Using redirect URL:', redirectURL);
        
        const authURL = new URL('https://accounts.google.com/o/oauth2/auth');
        authURL.searchParams.append('client_id', clientId);
        authURL.searchParams.append('response_type', 'token');
        authURL.searchParams.append('redirect_uri', redirectURL);
        authURL.searchParams.append('scope', scopes);
        authURL.searchParams.append('access_type', 'offline'); // For refresh token
        
        // Launch auth flow
        console.log('[AUTH] Launching web auth flow with URL:', authURL.toString());
        
        chrome.identity.launchWebAuthFlow({
          url: authURL.toString(),
          interactive
        }, (responseUrl) => {
          if (chrome.runtime.lastError) {
            console.error('[AUTH] WebAuthFlow error:', chrome.runtime.lastError);
            return reject(chrome.runtime.lastError);
          }
          
          if (!responseUrl) {
            return reject(new Error('No response URL returned from auth flow'));
          }
          
          // Parse access token from URL fragment
          try {
            const urlFragment = responseUrl.split('#')[1];
            const params = new URLSearchParams(urlFragment);
            const accessToken = params.get('access_token');
            
            if (!accessToken) {
              return reject(new Error('No access token found in response'));
            }
            
            console.log('[AUTH] WebAuthFlow succeeded, got access token');
            resolve(accessToken);
          } catch (error) {
            console.error('[AUTH] Failed to parse auth response:', error);
            reject(error);
          }
        });
      } catch (error) {
        console.error('[AUTH] WebAuthFlow setup failed:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Diagnose OAuth errors to provide more helpful feedback
   * @param {Error} error - Error object from OAuth operation
   * @private
   */
  _diagnoseOAuthErrors(error) {
    try {
      const errorStr = JSON.stringify(error);
      
      if (errorStr.includes('bad client id')) {
        console.error('========== OAUTH CONFIGURATION ERROR ==========');
        console.error('Bad Client ID detected. This means the OAuth client ID in manifest.json');
        console.error('is not properly configured in the Google API Console.');
        console.error('');
        console.error('To fix this:');
        console.error('1. Verify the client ID in manifest.json');
        console.error('2. Confirm this ID is registered in Google API Console');
        console.error('3. Ensure it is configured as a Chrome App client type');
        console.error('4. Add chrome-extension://<YOUR_EXTENSION_ID> to allowed origins');
        console.error('5. Check that the Calendar API is enabled for this project');
        console.error('==============================================');
      } else if (errorStr.includes('access_denied')) {
        console.error('User denied access or cancelled the auth flow');
      } else if (errorStr.includes('popup_closed_by_user')) {
        console.error('Auth popup was closed by user before completion');
      }
    } catch (e) {
      // Do nothing if diagnostic fails
    }
  }
  
  /**
   * Special workaround for trying to refresh token in service worker context
   * @private
   */
  _tryServiceWorkerRefresh() {
    console.log('[AUTH] Attempting service worker token refresh workaround');
    
    // Clear any stored token data that might be causing issues
    chrome.storage.local.remove(['oauth_token', 'token_expiry'], () => {
      // Even though direct getAuthToken often fails in service workers,
      // we'll try with a simple implementation as a last resort
      try {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (chrome.runtime.lastError || !token) {
            console.warn('[AUTH] Service worker token refresh failed:', 
                         chrome.runtime.lastError || 'No token returned');
            return;
          }
          
          console.log('[AUTH] Service worker refresh succeeded');
          
          // Store the new token
          chrome.storage.local.set({
            oauth_token: token,
            token_expiry: Date.now() + (3600 * 1000), // 1 hour
            token_needs_refresh: false // Clear the refresh flag
          }, () => {
            console.log('[AUTH] Token saved from service worker refresh');
          });
        });
      } catch (e) {
        console.error('[AUTH] Error in service worker refresh:', e);
      }
    });
  }
  
  /**
   * Sets up periodic checks for token refresh requests from storage
   * This is a workaround for service worker limitations with messaging
   * @private
   */
  _setupStorageRefreshCheck() {
    // Only run this in UI context, not service worker
    if (this.isServiceWorker) return;
    
    console.log('[AUTH] Setting up storage-based refresh checks');
    
    // Check immediately on startup
    this._checkStorageForRefreshRequest();
    
    // Check every 30 seconds for refresh requests
    // This interval is reasonable for checking without excessive overhead
    this.storageCheckInterval = setInterval(() => {
      this._checkStorageForRefreshRequest();
    }, 30 * 1000); // 30 seconds
  }
  
  /**
   * Checks storage for token refresh requests and handles them
   * @private
   */
  _checkStorageForRefreshRequest() {
    // Only run in UI context
    if (this.isServiceWorker) return;
    
    chrome.storage.local.get(['token_needs_refresh', 'token_refresh_requested'], (data) => {
      if (data.token_needs_refresh === true) {
        const requestTime = data.token_refresh_requested || Date.now();
        const requestAge = Date.now() - requestTime;
        
        // Only handle requests that are recent (less than 5 minutes old)
        // This prevents handling very old refresh requests repeatedly
        if (requestAge < 5 * 60 * 1000) {
          console.log(`[AUTH] Found token refresh request from ${Math.round(requestAge/1000)}s ago, refreshing`);
          
          // Clear the request flag immediately to prevent duplicate refreshes
          chrome.storage.local.set({ 'token_needs_refresh': false }, () => {
            // Attempt the refresh
            this.refreshToken(true).then(() => {
              console.log('[AUTH] Token refresh from storage request succeeded');
            }).catch(err => {
              console.warn('[AUTH] Failed to refresh token from storage request:', err);
            });
          });
        } else {
          console.log(`[AUTH] Found stale token refresh request (${Math.round(requestAge/1000)}s old), clearing`);
          chrome.storage.local.set({ 'token_needs_refresh': false });
        }
      }
    });
  }
  
  /**
   * Schedule a token refresh to occur before the current token expires
   * @private
   */
  _scheduleTokenRefresh() {
    // Only schedule if we have a token and expiry
    if (!this.token || !this.tokenExpiry) {
      console.log('[AUTH] Cannot schedule refresh - no token or expiry');
      return;
    }
    
    // Calculate time until expiration
    const timeToExpiry = this.tokenExpiry - Date.now();
    if (timeToExpiry <= 0) {
      // Already expired, refresh immediately
      console.log('[AUTH] Token already expired, refreshing immediately');
      this.refreshToken(true).catch(err => {
        console.warn('[AUTH] Failed to refresh expired token:', err);
      });
      return;
    }
    
    // Schedule refresh to occur at 80% of the token's lifetime
    // This gives us enough time to handle refresh before expiry
    const refreshDelay = Math.max(timeToExpiry * 0.8, 0);
    
    // For testing, if refreshDelay is more than 4 minutes, force refresh sooner
    // This helps verify the refresh mechanism works
    const useShortRefresh = refreshDelay > (4 * 60 * 1000); // more than 4 minutes
    const actualRefreshDelay = useShortRefresh ? (2 * 60 * 1000) : refreshDelay; // 2 minutes for testing
    const refreshMinutes = actualRefreshDelay / (60 * 1000); // Convert to minutes for chrome.alarms
    
    if (useShortRefresh) {
      console.log('[AUTH] TESTING: Using shortened refresh time of 2 minutes for testing');
    }
    
    console.log(`[AUTH] Scheduling token refresh in ${Math.round(actualRefreshDelay / 1000)} seconds (${refreshMinutes.toFixed(2)} minutes)`);
    
    // Clear any existing alarm with the same name
    chrome.alarms.clear(this.TOKEN_REFRESH_ALARM, (wasCleared) => {
      console.log(`[AUTH] Previous alarm was${wasCleared ? '' : ' not'} cleared`);
      
      // Create new alarm for token refresh
      chrome.alarms.create(this.TOKEN_REFRESH_ALARM, {
        delayInMinutes: refreshMinutes
      });
      
      // Store the expected refresh time for persistence across service worker restarts
      const plannedRefreshTime = Date.now() + actualRefreshDelay;
      chrome.storage.local.set({
        'token_refresh_time': plannedRefreshTime
      }, () => {
        console.log(`[AUTH] Token refresh scheduled for ${new Date(plannedRefreshTime).toLocaleTimeString()}`);
        
        // Debug - verify the alarm was actually created
        chrome.alarms.getAll(alarms => {
          console.log('[AUTH] Current alarms after scheduling:', alarms);
          
          // Create a quick testing alarm to verify the alarm system works
          // This alarm will fire after 1 minute as a sanity check
          chrome.alarms.create('calendarRingbackTest', {
            delayInMinutes: 1
          });
          console.log('[AUTH] Created 1-minute test alarm to verify alarm system');  
        });
      });
    });
  }
  
  /**
   * Try an alternative authentication approach as fallback
   * @param {string} clientId - OAuth client ID
   * @param {string} scopes - OAuth scopes
   * @returns {Promise<string>} The OAuth token
   * @private
   */
  async _tryAlternativeAuth(clientId, scopes) {
    return new Promise((resolve, reject) => {
      try {
        console.log('Attempting alternative auth approach...');
        
        // Get the redirect URL - use a special redirect URI that doesn't need pre-registration
        const redirectURL = 'urn:ietf:wg:oauth:2.0:oob';
        console.log('Using alternative redirect URI:', redirectURL);
        
        // Create auth URL for the alternative approach
        const authURL = 'https://accounts.google.com/o/oauth2/auth' +
          '?client_id=' + encodeURIComponent(clientId) +
          '&response_type=token' +
          '&redirect_uri=' + encodeURIComponent(redirectURL) +
          '&scope=' + encodeURIComponent(scopes);
          
        console.log('Alternative auth URL:', authURL);
        
        // Open in a new tab
        chrome.tabs.create({ url: authURL }, (tab) => {
          console.log('Alternative auth tab opened');
          
          const tabListener = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'complete') {
              chrome.tabs.executeScript(tab.id, {
                code: `
                  var token = '';
                  if (document.body.innerText.includes('Success code=')) {
                    token = document.body.innerText.match(/Success code=([^\s]+)/)[1];
                  }
                  token;
                `
              }, (results) => {
                if (chrome.runtime.lastError) {
                  console.error('Script execution error:', chrome.runtime.lastError);
                  return;
                }
                
                const token = results && results[0];
                if (token) {
                  console.log('Token found in page');
                  chrome.tabs.onUpdated.removeListener(tabListener);
                  chrome.tabs.remove(tab.id);
                  resolve(token);
                }
              });
            }
          };
          
          chrome.tabs.onUpdated.addListener(tabListener);
          
          // Also set a timeout to clean up if the user doesn't complete auth
          setTimeout(() => {
            console.log('Alternative auth timeout - cleaning up listeners');
            chrome.tabs.onUpdated.removeListener(tabListener);
            reject(new Error('Alternative auth timeout'));
          }, 120000); // 2 minute timeout
        });
      } catch (error) {
        console.error('Alternative auth error:', error);
        reject(error);
      }
    });
  }
}

// Export as singleton
const authService = new AuthService();
export default authService;
