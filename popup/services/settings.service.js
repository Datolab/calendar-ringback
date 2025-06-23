/**
 * Settings Service for Calendar Ringback
 * Handles all user settings and preferences
 */

import errorTracker from '../../utils/error-tracking.js';

class SettingsService {
  constructor() {
    // Default settings
    this.defaultSettings = {
      notificationTiming: 60, // seconds before meeting to show notification
      autoJoin: false,        // automatically join meeting on notification
      ringtone: 'classic',    // default ringtone
      firstRun: true          // whether this is the first run
    };
    
    this.settings = { ...this.defaultSettings };
  }
  
  /**
   * Load settings from storage
   * @returns {Promise<Object>} The current settings
   */
  async loadSettings() {
    try {
      return new Promise((resolve) => {
        chrome.storage.local.get(Object.keys(this.defaultSettings), (data) => {
          // Merge with defaults for any missing settings
          this.settings = { 
            ...this.defaultSettings,
            ...data 
          };
          
          console.log('Settings loaded:', this.settings);
          resolve(this.settings);
        });
      });
    } catch (error) {
      errorTracker.logError('Failed to load settings', { error });
      return this.defaultSettings;
    }
  }
  
  /**
   * Save settings to storage
   * @param {Object} newSettings - Settings to save
   * @returns {Promise<Object>} The updated settings
   */
  async saveSettings(newSettings) {
    try {
      // Validate settings
      this._validateSettings(newSettings);
      
      // Update local settings
      this.settings = {
        ...this.settings,
        ...newSettings
      };
      
      // Save to storage
      return new Promise((resolve) => {
        chrome.storage.local.set(this.settings, () => {
          if (chrome.runtime.lastError) {
            throw chrome.runtime.lastError;
          }
          
          console.log('Settings saved:', this.settings);
          
          // Notify background of settings change
          chrome.runtime.sendMessage({ 
            action: 'settingsUpdated', 
            settings: this.settings 
          });
          
          resolve(this.settings);
        });
      });
    } catch (error) {
      errorTracker.logError('Failed to save settings', { error });
      throw error;
    }
  }
  
  /**
   * Get the value of a specific setting
   * @param {string} key - The setting key
   * @param {any} defaultValue - Default value if setting not found
   * @returns {any} The setting value
   */
  getSetting(key, defaultValue = null) {
    return this.settings[key] !== undefined ? this.settings[key] : defaultValue;
  }
  
  /**
   * Update a single setting
   * @param {string} key - The setting key
   * @param {any} value - The new value
   * @returns {Promise<Object>} The updated settings
   */
  async updateSetting(key, value) {
    const updatedSettings = { [key]: value };
    return await this.saveSettings(updatedSettings);
  }
  
  /**
   * Check if this is the first run of the extension
   * @returns {Promise<boolean>} True if first run
   */
  async isFirstRun() {
    await this.loadSettings();
    return this.settings.firstRun === true;
  }
  
  /**
   * Mark first run as complete
   * @returns {Promise<Object>} The updated settings
   */
  async completeFirstRun() {
    return await this.updateSetting('firstRun', false);
  }
  
  /**
   * Reset all settings to defaults
   * @returns {Promise<Object>} The default settings
   */
  async resetSettings() {
    try {
      return await this.saveSettings(this.defaultSettings);
    } catch (error) {
      errorTracker.logError('Failed to reset settings', { error });
      throw error;
    }
  }
  
  // PRIVATE METHODS
  
  /**
   * Validate settings object
   * @param {Object} settings - Settings to validate
   * @private
   */
  _validateSettings(settings) {
    // Ensure notificationTiming is a number between 0 and 300
    if ('notificationTiming' in settings) {
      const timing = parseInt(settings.notificationTiming, 10);
      if (isNaN(timing) || timing < 0 || timing > 300) {
        throw new Error('Invalid notification timing. Must be between 0 and 300 seconds.');
      }
      settings.notificationTiming = timing;
    }
    
    // Ensure autoJoin is a boolean
    if ('autoJoin' in settings && typeof settings.autoJoin !== 'boolean') {
      settings.autoJoin = Boolean(settings.autoJoin);
    }
    
    // Ensure ringtone is valid
    if ('ringtone' in settings && !['classic', 'digital', 'old'].includes(settings.ringtone)) {
      throw new Error('Invalid ringtone selection.');
    }
    
    // Ensure firstRun is a boolean
    if ('firstRun' in settings && typeof settings.firstRun !== 'boolean') {
      settings.firstRun = Boolean(settings.firstRun);
    }
    
    return settings;
  }
}

// Export as singleton
const settingsService = new SettingsService();
export default settingsService;
