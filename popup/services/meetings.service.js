/**
 * Meetings Service for Calendar Ringback
 * Handles retrieving and processing calendar events
 */

import errorTracker from '../../utils/error-tracking.js';
import authService from './auth.service.js';

class MeetingsService {
  constructor() {
    this.upcomingMeetings = [];
    this.isLoading = false;
    this.lastFetchTime = null;
  }
  
  /**
   * Load upcoming meetings from Google Calendar
   * @param {number} maxResults - Maximum number of results to return
   * @param {number} lookAheadMinutes - Minutes to look ahead for events
   * @returns {Promise<Array>} Array of upcoming meetings
   */
  async loadUpcomingMeetings(maxResults = 10, lookAheadMinutes = 60) {
    try {
      // Don't fetch if already loading
      if (this.isLoading) {
        console.log('Already loading meetings, skipping request');
        return this.upcomingMeetings;
      }
      
      this.isLoading = true;
      
      // Check if authenticated
      const isAuthenticated = await authService.isAuthenticated();
      if (!isAuthenticated) {
        // This is an expected state during initialization, not an error
        console.log('Not authenticated or initializing, skipping meeting fetch');
        this.isLoading = false;
        return [];
      }
      
      // Get the token
      const token = authService.getToken();
      if (!token) {
        this.isLoading = false;
        // Don't throw, just return empty array when no token
        console.log('No auth token available, skipping meeting fetch');
        return [];
      }
      
      // Calculate time bounds
      const now = new Date();
      const timeMin = now.toISOString();
      
      const timeMax = new Date(now.getTime() + (lookAheadMinutes * 60000));
      
      // Build request URL
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      url.searchParams.append('maxResults', maxResults);
      url.searchParams.append('orderBy', 'startTime');
      url.searchParams.append('singleEvents', 'true');
      url.searchParams.append('timeMin', timeMin);
      url.searchParams.append('timeMax', timeMax.toISOString());
      
      console.log(`Fetching meetings from ${timeMin} to ${timeMax.toISOString()}`);
      
      // Make the API request
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        // Handle 401 unauthorized (expired token)
        if (response.status === 401) {
          // Try to refresh the token
          console.log('Token expired (401), attempting to refresh...');
          await authService.refreshToken();
          
          // Retry the request
          return await this.loadUpcomingMeetings(maxResults, lookAheadMinutes);
        }
        
        throw new Error(`Failed to fetch meetings: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      this.lastFetchTime = new Date();
      
      // Process meetings
      this.upcomingMeetings = this._processMeetings(data.items || []);
      
      console.log(`Found ${this.upcomingMeetings.length} upcoming meetings`);
      
      return this.upcomingMeetings;
    } catch (error) {
      errorTracker.logError('Error loading upcoming meetings', { error });
      return [];
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Get currently cached upcoming meetings
   * @returns {Array} Array of upcoming meetings
   */
  getUpcomingMeetings() {
    return this.upcomingMeetings;
  }
  
  /**
   * Find meetings starting within a specific time window
   * @param {number} minutesWindow - Minutes window to check
   * @returns {Promise<Array>} Meetings starting soon
   */
  async getMeetingsStartingSoon(minutesWindow = 5) {
    try {
      // Ensure we have fresh data
      await this.loadUpcomingMeetings(10, minutesWindow + 5);
      
      const now = new Date();
      const windowEnd = new Date(now.getTime() + (minutesWindow * 60000));
      
      // Filter meetings that start within the window
      return this.upcomingMeetings.filter(meeting => {
        const startTime = new Date(meeting.start);
        return startTime >= now && startTime <= windowEnd;
      });
    } catch (error) {
      errorTracker.logError('Error getting meetings starting soon', { error });
      return [];
    }
  }
  
  // PRIVATE METHODS
  
  /**
   * Process raw meeting data from API
   * @param {Array} meetings - Raw meeting data from API
   * @returns {Array} Processed meeting objects
   * @private
   */
  _processMeetings(meetings) {
    return meetings
      // Filter only meetings with conferencing data (Google Meet)
      .filter(event => {
        return event.conferenceData && 
               event.conferenceData.conferenceId && 
               event.conferenceData.entryPoints &&
               event.conferenceData.entryPoints.some(entry => entry.entryPointType === 'video');
      })
      // Transform to simpler format
      .map(event => {
        // Get the Google Meet URL
        const videoEntry = event.conferenceData.entryPoints.find(
          entry => entry.entryPointType === 'video'
        );
        
        // Get start and end times
        const startDateTime = event.start.dateTime || null;
        const endDateTime = event.end.dateTime || null;
        
        // Get list of attendees
        const attendees = event.attendees || [];
        
        return {
          id: event.id,
          title: event.summary || 'Untitled meeting',
          description: event.description || '',
          start: startDateTime,
          end: endDateTime,
          meetLink: videoEntry ? videoEntry.uri : null,
          organizer: event.organizer ? event.organizer.email : 'Unknown',
          attendees: attendees.map(a => ({
            email: a.email,
            name: a.displayName || a.email,
            responseStatus: a.responseStatus || 'needsAction',
            organizer: a.organizer || false
          }))
        };
      })
      // Sort by start time
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }
}

// Export as singleton
const meetingsService = new MeetingsService();
export default meetingsService;
