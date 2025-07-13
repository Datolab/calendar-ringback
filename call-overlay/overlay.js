// Google Calendar Callback Extension - Call Overlay Logic

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const meetingTitle = document.getElementById('meeting-title');
  const meetingTime = document.getElementById('meeting-time');
  const callerInitials = document.getElementById('caller-initials');
  const participantsList = document.getElementById('participants-list');
  const answerButton = document.getElementById('answer-button');
  const declineButton = document.getElementById('decline-button');
  const snoozeButton = document.getElementById('snooze-button');
  const ringtone = document.getElementById('ringtone');
  const timer = document.getElementById('timer');
  const callCard = document.querySelector('.call-card');
  
  // Meeting data
  let meetingData = null;
  
  // Auto-dismiss timer
  let autoDismissTimer = null;
  
  // Initialize
  initializeCallOverlay();
  
  // Check for auto-join setting and handle automatically
  chrome.storage.local.get('userSettings', (result) => {
    console.log('Initial settings check in overlay (userSettings):', result);
    const settings = result.userSettings || {};
    if (settings.autoJoin) {
      console.log('Auto-join enabled, automatically answering call...');
      handleAnswer();
    } else {
      console.log('Auto-join not enabled or settings not found. Current settings:', settings);
    }
  });
  
  // Event Listeners
  answerButton.addEventListener('click', handleAnswer);
  declineButton.addEventListener('click', handleDecline);
  snoozeButton.addEventListener('click', handleSnooze);
  
  // Functions
  function initializeCallOverlay() {
    // Parse meeting data from URL
    const urlParams = new URLSearchParams(window.location.search);
    const meetingParam = urlParams.get('meeting');
    
    if (meetingParam) {
      try {
        meetingData = JSON.parse(decodeURIComponent(meetingParam));
        
        // Display meeting info
        displayMeetingInfo();
        
        // Add ringing animation
        callCard.classList.add('ringing');
        
        // Start ringtone
        playRingtone();
        
        // Start countdown for auto-dismiss (2 minutes)
        startAutoDismissTimer();
        
        // Start call timer
        updateTimer();
      } catch (error) {
        console.error('Error parsing meeting data:', error);
        meetingTitle.textContent = 'Error loading meeting';
      }
    } else {
      meetingTitle.textContent = 'No meeting data provided';
    }
  }
  
  function displayMeetingInfo() {
    // Set meeting title
    meetingTitle.textContent = meetingData.title;
    
    // Set initials from meeting title
    callerInitials.textContent = getInitials(meetingData.title);
    
    // Format and set meeting time
    const startTime = new Date(meetingData.startTime);
    meetingTime.textContent = formatTime(startTime);
    
    // Display participants
    if (meetingData.attendees && meetingData.attendees.length > 0) {
      // Clear participants list
      participantsList.innerHTML = '';
      
      // Add each participant
      meetingData.attendees.forEach(attendee => {
        if (!attendee.self) { // Skip the current user
          const participant = document.createElement('div');
          participant.className = 'participant';
          
          const initials = document.createElement('div');
          initials.className = 'participant-initials';
          initials.textContent = getInitials(attendee.displayName || attendee.email);
          
          const name = document.createElement('span');
          name.textContent = attendee.displayName || attendee.email.split('@')[0];
          
          participant.appendChild(initials);
          participant.appendChild(name);
          participantsList.appendChild(participant);
        }
      });
    } else {
      const noParticipants = document.createElement('p');
      noParticipants.textContent = 'No other participants';
      participantsList.appendChild(noParticipants);
    }
  }
  
  async function playRingtone() {
    try {
      // Get user settings from storage
      const result = await new Promise(resolve => {
        chrome.storage.local.get('userSettings', resolve);
      });
      
      const settings = result.userSettings || {};
      console.log('Current ringtone settings from storage (userSettings):', settings);
      
      // Map ringtone names to their corresponding audio files
      const ringtoneMap = {
        'classic': 'classic-ring.mp3',
        'digital': 'digital-ring.mp3',
        'old': 'old-ring.mp3'
      };
      
      // Get the ringtone name with fallback
      const ringtoneName = (settings.ringtone || 'classic').toLowerCase();
      const soundFile = `../assets/audio/${ringtoneMap[ringtoneName] || ringtoneMap['classic']}`;
      console.log('Selected ringtone file:', soundFile, 'for setting:', settings.ringtone);
      
      console.log('Playing ringtone:', soundFile);
      
      // Set ringtone source
      ringtone.src = chrome.runtime.getURL(soundFile);
      
      // Play ringtone
      await ringtone.play();
    } catch (error) {
      console.error('Error playing ringtone:', error);
    }
  }
  
  function stopRingtone() {
    ringtone.pause();
    ringtone.currentTime = 0;
    callCard.classList.remove('ringing');
  }
  
  function startAutoDismissTimer() {
    // Auto-dismiss after 2 minutes
    autoDismissTimer = setTimeout(() => {
      handleDecline();
    }, 2 * 60 * 1000); // 2 minutes
  }
  
  function updateTimer() {
    const startTime = new Date(meetingData.startTime);
    const now = new Date();
    
    // Calculate difference in minutes
    const diffMs = startTime - now;
    const diffMins = Math.round(diffMs / 1000 / 60);
    
    if (diffMins > 0) {
      timer.textContent = `Starts in ${diffMins} min`;
      setTimeout(updateTimer, 60000); // Update every minute
    } else if (diffMins === 0) {
      timer.textContent = 'Starting now';
    } else {
      timer.textContent = `Started ${Math.abs(diffMins)} min ago`;
    }
  }
  
  async function handleAnswer() {
    // Stop ringtone
    stopRingtone();
    
    // Clear auto-dismiss timer
    clearTimeout(autoDismissTimer);
    
    // Get settings from userSettings key
    const result = await chrome.storage.local.get('userSettings');
    const settings = result.userSettings || {};
    const autoJoin = settings.autoJoin || false;
    console.log('Auto-join setting in handleAnswer:', { autoJoin, allSettings: settings });
    
    // Mark this meeting as joined
    await markMeetingAsProcessed(meetingData.id, 'joined');
    
    // Open the Meet link in a new tab
    if (meetingData.meetLink) {
      await chrome.tabs.create({ url: meetingData.meetLink, active: autoJoin });
    }
    
    // Close this window
    window.close();
  }
  
  async function handleDecline() {
    // Stop ringtone
    stopRingtone();
    
    // Clear auto-dismiss timer
    clearTimeout(autoDismissTimer);
    
    // Mark this meeting as declined
    await markMeetingAsProcessed(meetingData.id, 'declined');
    
    // Close this window
    window.close();
  }
  
  async function handleSnooze() {
    // Stop ringtone
    stopRingtone();
    
    // Clear auto-dismiss timer
    clearTimeout(autoDismissTimer);
    
    // Mark this meeting for snoozing
    await markMeetingAsProcessed(meetingData.id, 'snoozed');
    
    // Set alarm for 2 minutes later
    const snoozeTime = new Date();
    snoozeTime.setMinutes(snoozeTime.getMinutes() + 2);
    
    chrome.alarms.create(`eventReminder_${meetingData.id}`, {
      when: snoozeTime.getTime()
    });
    
    // Close this window
    window.close();
  }
  
  async function markMeetingAsProcessed(eventId, action) {
    try {
      const { processedEvents = [] } = await chrome.storage.local.get('processedEvents');
      
      // Find if event is already in the list
      const existingIndex = processedEvents.findIndex(item => 
        item.id === eventId
      );
      
      if (existingIndex >= 0) {
        // Update existing event
        processedEvents[existingIndex] = {
          id: eventId,
          action,
          timestamp: new Date().toISOString()
        };
      } else {
        // Add new event
        processedEvents.push({
          id: eventId,
          action,
          timestamp: new Date().toISOString()
        });
      }
      
      // Save back to storage
      await chrome.storage.local.set({ processedEvents });
    } catch (error) {
      console.error('Error marking meeting as processed:', error);
    }
  }
  
  // Helper Functions
  function getInitials(name) {
    if (!name) return '?';
    
    const words = name.trim().split(' ');
    if (words.length === 1) {
      return name.substring(0, 2).toUpperCase();
    }
    
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  
  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + 
           ' - ' + 
           new Date(date.getTime() + 30*60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
});
