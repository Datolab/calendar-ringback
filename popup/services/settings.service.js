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
    console.log('📂 Settings Service: loadSettings called');
    
    return new Promise((resolve, reject) => {
      // First, try to get all storage data for debugging
      chrome.storage.local.get(null, (allData) => {
        console.log('📂 DEBUG - All storage data:', allData);
        
        // Then specifically get the userSettings
        chrome.storage.local.get('userSettings', (data) => {
          // Handle any errors from the storage API
          if (chrome.runtime.lastError) {
            console.error('📂 Error accessing storage:', chrome.runtime.lastError);
            errorTracker.logError('Storage access error', { error: chrome.runtime.lastError });
            // Return defaults on error but don't overwrite storage
            resolve({ ...this.defaultSettings });
            return;
          }
          
          console.log('📂 DEBUG - userSettings key data:', data);
          
          // Check if we have valid settings
          const hasValidSettings = data && data.userSettings && typeof data.userSettings === 'object' && 
                                 Object.keys(data.userSettings).length > 0;
          
          if (hasValidSettings) {
            console.log('📂 Settings loaded from userSettings key:', data.userSettings);
            
            // Merge with defaults to ensure all settings exist
            const mergedSettings = {
              ...this.defaultSettings,
              ...data.userSettings
            };
            
            console.log('📂 Merged settings (defaults + userSettings):', mergedSettings);
            
            // Update the instance settings
            this.settings = mergedSettings;
            
            // Save the merged settings back to ensure all defaults are set
            chrome.storage.local.set({ userSettings: this.settings }, () => {
              if (chrome.runtime.lastError) {
                console.error('📂 Error saving merged settings:', chrome.runtime.lastError);
                errorTracker.logError('Failed to save merged settings', { error: chrome.runtime.lastError });
                // Even if save fails, return the merged settings we have in memory
                resolve(this.settings);
              } else {
                console.log('📂 Successfully saved merged settings');
                resolve(this.settings);
              }
            });
            
          } else {
            console.log('📂 No valid userSettings found, using and saving defaults');
            // If no settings found, use and save the defaults
            this.settings = { ...this.defaultSettings };
            
            chrome.storage.local.set({ userSettings: this.settings }, () => {
              if (chrome.runtime.lastError) {
                console.error('📂 Error saving default settings:', chrome.runtime.lastError);
                errorTracker.logError('Failed to save default settings', { error: chrome.runtime.lastError });
                // Even if save fails, return the default settings we have in memory
                resolve(this.settings);
              } else {
                console.log('📂 Saved default settings to storage');
                resolve(this.settings);
              }
            });
          }
        });
      });
    });
  }
  
  /**
   * Save settings to storage
   * @param {Object} newSettings - Settings to save
   * @returns {Promise<Object>} The updated settings
   */
  async saveSettings(newSettings) {
    console.log('💾 SAVE - Settings service saveSettings called with:', newSettings);
    console.log('💾 SAVE - Auto-join value:', newSettings.autoJoin, typeof newSettings.autoJoin);
    
    try {
      // Validate settings
      this._validateSettings(newSettings);
      console.log('💾 SAVE - Settings validated successfully');
      
      // Update local settings
      this.settings = {
        ...this.settings,
        ...newSettings
      };
      console.log('💾 SAVE - Updated local settings object:', this.settings);
      console.log('💾 SAVE - Auto-join in settings object:', this.settings.autoJoin, typeof this.settings.autoJoin);
      
      // Save to storage - always use userSettings key for consistency
      return new Promise((resolve, reject) => {
        console.log('💾 SAVE - About to save to storage with key userSettings:', { userSettings: this.settings });
        
        chrome.storage.local.set({ userSettings: this.settings }, () => {
          if (chrome.runtime.lastError) {
            console.error('💾 SAVE - Error saving settings:', chrome.runtime.lastError);
            errorTracker.logError('Chrome storage error', { error: chrome.runtime.lastError });
            reject(chrome.runtime.lastError);
            return;
          }
          
          console.log('💾 SAVE - Settings saved successfully:', this.settings);
          
          // Notify background of settings change
          try {
            // Ensure we properly handle cases where the background script may not be active
            if (!chrome.runtime?.id) {
              console.warn('Runtime not available, settings saved locally only');
              return resolve(this.settings);
            }
            
            chrome.runtime.sendMessage({ 
              action: 'settingsUpdated', 
              settings: this.settings 
            }, response => {
              // Check for runtime errors first
              if (chrome.runtime.lastError) {
                console.warn('Settings saved but notification failed:', chrome.runtime.lastError.message);
                // Don't reject - settings were saved successfully even if notification failed
                return resolve(this.settings);
              }
              
              // Check if we got a valid response
              if (!response) {
                console.warn('Settings saved but got empty response from background');
                return resolve(this.settings);
              }
              
              if (response.error) {
                console.error('Background reported error:', response.error);
                errorTracker.logError('Background settings error', { error: response.error });
                // Don't reject since storage part succeeded
              }
              
              console.log('Settings updated and synchronized with background');
              resolve(this.settings);
            });
          } catch (msgError) {
            console.warn('Settings saved but notification error:', msgError);
            errorTracker.logError('Settings notification error', { error: msgError });
            // Still resolve since storage succeeded
            resolve(this.settings);
          }
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
      console.log('🔍 VALIDATE - Raw notification timing:', settings.notificationTiming, 'Parsed:', timing);
      
      if (isNaN(timing) || timing < 0 || timing > 300) {
        console.error('❌ Invalid notification timing:', timing, 'Must be between 0 and 300 seconds');
        throw new Error('Invalid notification timing. Must be between 0 and 300 seconds.');
      }
      
      // Ensure we store as a number
      settings.notificationTiming = timing;
      console.log('✅ Notification timing validated and set to:', timing, 'seconds');
    }
    
    // Ensure autoJoin is a boolean
    if ('autoJoin' in settings) {
      // Force explicit conversion to a boolean, regardless of input type
      settings.autoJoin = settings.autoJoin === true || settings.autoJoin === 'true' || settings.autoJoin === 1;
      console.log('🧪 VALIDATE: autoJoin converted to', settings.autoJoin, typeof settings.autoJoin);
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
