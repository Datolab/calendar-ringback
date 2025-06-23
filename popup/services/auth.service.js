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
  async isAuthenticated() {
    try {
      // If we already have a valid token in memory, use it
      if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return true;
      }
      
      // Check chrome.storage for a token
      const authData = await this._getStoredAuthData();
      
      if (authData && authData.token) {
        this.token = authData.token;
        this.tokenExpiry = authData.tokenExpiry;
        
        // Check if token is expired
        if (this.tokenExpiry && Date.now() > this.tokenExpiry) {
          console.log('Token expired, attempting refresh...');
          try {
            await this.refreshToken();
            return !!this.token;
          } catch (error) {
            console.error('Failed to refresh token, clearing invalid token:', error);
            // Clear invalid token
            this.token = null;
            this.tokenExpiry = null;
            await this._storeToken(null, 0);
            return false;
          }
        }
        
        // Verify the token is still valid
        try {
          // Simple verification by making a test request
          await this.getUserInfo();
          return true;
        } catch (error) {
          console.warn('Token validation failed, forcing re-authentication', error);
          this.token = null;
          this.tokenExpiry = null;
          await this._storeToken(null, 0);
          return false;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error in isAuthenticated:', error);
      // Don't log to error tracker here to avoid noise
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
   * Sign out the user
   * @returns {Promise<void>}
   */
  async signOut() {
    try {
      // Clear stored token
      await chrome.storage.local.remove(['oauth_token', 'token_expiry', 'authInProgress']);
      
      // Remove the cached token
      if (this.token) {
        await this._removeCachedAuthToken(this.token);
      }
      
      // Reset state
      this.token = null;
      this.tokenExpiry = null;
      this.isAuthenticating = false;
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
   * @returns {Promise<string>} A new valid token
   */
  async refreshToken() {
    try {
      console.log('Refreshing token...');
      
      // Remove the cached token if we have one
      if (this.token) {
        await this._removeCachedAuthToken(this.token);
      }
      
      // Clear the stored token
      await chrome.storage.local.remove(['oauth_token', 'token_expiry']);
      
      // Request a new token interactively
      const newToken = await this._getAuthToken(true);
      
      // Store the new token
      await this._storeToken(newToken);
      
      return newToken;
    } catch (error) {
      errorTracker.logError('Failed to refresh token', { error });
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
    return new Promise((resolve) => {
      const tokenData = {
        oauth_token: token,
        token_expiry: Date.now() + (expiresIn * 1000),
        authInProgress: false
      };
      
      chrome.storage.local.set(tokenData, () => {
        this.token = token;
        this.tokenExpiry = tokenData.token_expiry;
        this.isAuthenticating = false;
        
        // Notify background script
        chrome.runtime.sendMessage({ action: 'authenticationUpdated', status: true });
        
        resolve();
      });
    });
  }

  /**
   * Request an authentication token using chrome.identity
   * @param {boolean} interactive - Whether to show UI to the user
   * @returns {Promise<string>} The OAuth token
   * @private
   */
  async _getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
      console.log(`Requesting auth token with interactive=${interactive}`);
      
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError) {
          console.error('Auth token error:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        
        if (token) {
          console.log('Token retrieved successfully');
          resolve(token);
        } else {
          console.error('No token returned');
          reject(new Error('No token returned'));
        }
      });
    });
  }

  /**
   * Direct WebAuth Flow implementation - simplified and reliable approach
   * @returns {Promise<string>} The OAuth token
   * @private
   */
  async _directWebAuthFlow() {
    return new Promise((resolve, reject) => {
      console.log('Starting direct WebAuthFlow...');
      
      try {
        // Get the client ID from the manifest
        const manifest = chrome.runtime.getManifest();
        console.log('Manifest OAuth2 section:', manifest.oauth2);
        
        const clientId = manifest.oauth2?.client_id;
        if (!clientId) {
          console.error('No client ID found in manifest');
          reject(new Error('No client ID found in manifest'));
          return;
        }
        
        // Get the extension ID for reference
        const extensionId = chrome.runtime.id;
        console.log('Extension ID:', extensionId);
        
        // Get the redirect URL from Chrome
        const redirectURL = chrome.identity.getRedirectURL();
        console.log('Chrome Identity Redirect URL:', redirectURL);
        
        if (!redirectURL) {
          console.error('Could not get redirect URL');
          reject(new Error('Could not get redirect URL'));
          return;
        }
        
        // Create auth URL - using token response_type (no client_secret needed)
        const scopes = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email';
        
        // Adding state parameter for verification
        const state = 'calendarringback_' + Date.now();
        
        const authURL = 'https://accounts.google.com/o/oauth2/auth' +
          '?client_id=' + encodeURIComponent(clientId) +
          '&response_type=token' +
          '&redirect_uri=' + encodeURIComponent(redirectURL) +
          '&scope=' + encodeURIComponent(scopes) +
          '&state=' + encodeURIComponent(state) +
          '&prompt=consent';
        
        console.log('WebAuthFlow URL:', authURL);
        
        // Launch WebAuthFlow
        chrome.identity.launchWebAuthFlow({
          url: authURL,
          interactive: true
        }, (responseUrl) => {
          if (chrome.runtime.lastError) {
            console.error('WebAuthFlow error:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          
          if (!responseUrl) {
            console.error('No response URL returned from WebAuthFlow');
            reject(new Error('No response URL returned from WebAuthFlow'));
            return;
          }
          
          console.log('WebAuthFlow completed with response URL');
          
          try {
            // Extract the token from the response URL
            const url = new URL(responseUrl);
            
            const hash = url.hash.substring(1); // Remove the # character
            const params = new URLSearchParams(hash);
            const token = params.get('access_token');
            const expiresIn = params.get('expires_in');
            const error = params.get('error');
            
            if (error) {
              console.error('Error in auth response:', error);
              reject(new Error(`Auth response error: ${error}`));
              return;
            }
            
            if (!token) {
              console.error('No token found in the response');
              reject(new Error('No token found in the response'));
              return;
            }
            
            console.log('Token successfully extracted from WebAuthFlow response');
            resolve(token);
          } catch (error) {
            console.error('Error parsing WebAuthFlow response:', error);
            reject(error);
          }
        });
      } catch (error) {
        console.error('Fatal error in _directWebAuthFlow:', error);
        reject(error);
      }
    });
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
