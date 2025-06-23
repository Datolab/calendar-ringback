/**
 * Simple error tracking utility for the Calendar Ringback extension
 * Compatible with both browser context and service worker context
 */

class ErrorTracker {
  constructor() {
    this.errors = [];
    this.maxErrors = 50; // Limit stored errors to avoid excessive memory usage
    this.isServiceWorker = typeof window === 'undefined';
    this.init();
  }

  /**
   * Initialize error handlers
   */
  init() {
    // Set up error handlers only in browser context
    if (!this.isServiceWorker) {
      try {
        // Set up global error handler
        window.addEventListener('error', (event) => {
          this.captureError({
            type: 'uncaught_error',
            message: event.error?.message || 'Unknown error',
            stack: event.error?.stack,
            location: window.location.href,
            timestamp: new Date().toISOString()
          });
        });

        // Set up unhandled promise rejection handler
        window.addEventListener('unhandledrejection', (event) => {
          this.captureError({
            type: 'unhandled_rejection',
            message: event.reason?.message || 'Unhandled promise rejection',
            stack: event.reason?.stack,
            location: window.location.href,
            timestamp: new Date().toISOString()
          });
        });
      } catch (e) {
        console.error('Error setting up error listeners:', e);
      }
    }

    // Log initialization
    console.log('Calendar Callback: Error tracking initialized');
  }

  /**
   * Capture and store an error
   * @param {Object} errorData - Information about the error
   */
  captureError(errorData) {
    // Add error to the collection
    this.errors.unshift(errorData);
    
    // Keep errors array under the maximum length
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(0, this.maxErrors);
    }
    
    // Store errors in chrome.storage
    chrome.storage.local.set({ 'error_logs': this.errors });
    
    // Log to console for debugging
    console.error('Calendar Callback Error:', errorData);
  }

  /**
   * Manually capture an error or log
   * @param {string} message - Error message
   * @param {Object} details - Additional error details
   */
  logError(message, details = {}) {
    this.captureError({
      type: 'manual',
      message,
      details,
      location: window.location.href,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get all stored errors
   * @returns {Promise<Array>} Array of error objects
   */
  async getErrors() {
    return new Promise((resolve) => {
      chrome.storage.local.get('error_logs', (data) => {
        resolve(data.error_logs || []);
      });
    });
  }

  /**
   * Clear all stored errors
   */
  async clearErrors() {
    this.errors = [];
    await chrome.storage.local.remove('error_logs');
  }

  /**
   * Generate error report for submission
   * @returns {Promise<Object>} Error report data
   */
  async generateReport() {
    const errors = await this.getErrors();
    
    // Get extension and browser information
    const manifest = chrome.runtime.getManifest();
    const browserInfo = navigator.userAgent;
    
    return {
      extensionVersion: manifest.version,
      browserInfo,
      timestamp: new Date().toISOString(),
      errorCount: errors.length,
      errors
    };
  }

  /**
   * Send error report via email
   * Creates a mailto: link with error information
   */
  async sendErrorReport() {
    const report = await this.generateReport();
    const subject = `Calendar Callback Error Report - v${report.extensionVersion}`;
    const body = `
Error Report Details:
Extension Version: ${report.extensionVersion}
Browser: ${report.browserInfo}
Generated: ${report.timestamp}
Error Count: ${report.errorCount}

Recent Errors:
${JSON.stringify(report.errors.slice(0, 5), null, 2)}

Full report available on request.
`;

    // Create mailto link
    const mailtoLink = `mailto:support@example.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    // Open in new tab
    chrome.tabs.create({ url: mailtoLink });
    
    return true;
  }
}

// Export the singleton instance
const errorTracker = new ErrorTracker();
export default errorTracker;
