/**
 * Edge-specific authentication service
 * Handles OAuth flow for Microsoft Edge
 */

import { getBrowserConfig } from '../../config.js';

class EdgeAuthService {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.isAuthenticating = false;
    this.tokenRefreshAlarm = 'edgeTokenRefresh';
  }

  /**
   * Authenticate with Google OAuth
   * @returns {Promise<string>} Access token
   */
  async authenticate() {
    if (this.isAuthenticating) {
      throw new Error('Authentication already in progress');
    }

    this.isAuthenticating = true;
    
    try {
      const authUrl = this._buildAuthUrl();
      const responseUrl = await this._launchAuthFlow(authUrl);
      const token = this._extractTokenFromUrl(responseUrl);
      
      if (!token) {
        throw new Error('Failed to extract token from response');
      }
      
      this.token = token;
      this.tokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour expiry
      this._scheduleTokenRefresh();
      
      return token;
    } catch (error) {
      console.error('[EDGE AUTH] Authentication failed:', error);
      throw error;
    } finally {
      this.isAuthenticating = false;
    }
  }

  /**
   * Build the OAuth URL
   * @private
   */
  _buildAuthUrl() {
    const { clientId, redirectUri } = getBrowserConfig();
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' ');

    return `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=token&` +
      `scope=${encodeURIComponent(scopes)}`;
  }

  /**
   * Launch the OAuth flow
   * @param {string} url - The OAuth URL
   * @private
   */
  _launchAuthFlow(url) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        {
          url,
          interactive: true
        },
        (responseUrl) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(responseUrl);
        }
      );
    });
  }

  /**
   * Extract token from the OAuth response URL
   * @param {string} url - The OAuth response URL
   * @private
   */
  _extractTokenFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const params = new URLSearchParams(urlObj.hash.substring(1));
      return params.get('access_token');
    } catch (error) {
      console.error('[EDGE AUTH] Error extracting token from URL:', error);
      return null;
    }
  }

  /**
   * Schedule token refresh
   * @private
   */
  _scheduleTokenRefresh() {
    // Refresh token 5 minutes before expiry
    const refreshTime = this.tokenExpiry - (5 * 60 * 1000);
    const timeUntilRefresh = Math.max(0, refreshTime - Date.now());
    
    chrome.alarms.create(this.tokenRefreshAlarm, {
      when: Date.now() + timeUntilRefresh
    });
    
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === this.tokenRefreshAlarm) {
        this.authenticate().catch(console.error);
      }
    });
  }
}

// Export as singleton
const edgeAuthService = new EdgeAuthService();
export default edgeAuthService;
