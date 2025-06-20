// Google Calendar Callback Extension - Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const notSignedInSection = document.getElementById('not-signed-in');
  const signedInSection = document.getElementById('signed-in');
  const userEmailSpan = document.getElementById('user-email');
  const signInButton = document.getElementById('signin-button');
  const signOutButton = document.getElementById('signout-button');
  const statusSection = document.getElementById('status-section');
  const statusIcon = document.getElementById('status-icon');
  const statusText = document.getElementById('status-text');
  const upcomingList = document.getElementById('upcoming-list');
  const noMeetingsMsg = document.getElementById('no-meetings');
  const notificationTiming = document.getElementById('notification-timing');
  const autoJoinCheckbox = document.getElementById('auto-join');
  const ringtoneSelect = document.getElementById('ringtone');
  const testSoundButton = document.getElementById('test-sound');
  const saveSettingsButton = document.getElementById('save-settings');
  const firstRunModal = document.getElementById('first-run-modal');
  const firstRunContinue = document.getElementById('first-run-continue');
  const versionSpan = document.getElementById('version');

  // Initialize
  initializePopup();
  
  // Event Listeners
  signInButton.addEventListener('click', handleSignIn);
  signOutButton.addEventListener('click', handleSignOut);
  testSoundButton.addEventListener('click', testRingtone);
  saveSettingsButton.addEventListener('click', saveSettings);
  firstRunContinue.addEventListener('click', handleFirstRunContinue);
  
  // Functions
  async function initializePopup() {
    // Check if it's first run
    const { firstRun } = await chrome.storage.local.get('firstRun');
    
    if (firstRun) {
      firstRunModal.classList.remove('hidden');
    }
    
    // Load extension version
    const manifest = chrome.runtime.getManifest();
    versionSpan.textContent = `v${manifest.version}`;
    
    // Check auth status
    checkAuthStatus();
    
    // Load settings
    loadSettings();
    
    // Load upcoming meetings
    loadUpcomingMeetings();
  }
  
  async function checkAuthStatus() {
    try {
      const token = await getAuthToken(false);
      
      if (token) {
        // Get user info
        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const userInfo = await response.json();
          userEmailSpan.textContent = userInfo.email;
          
          notSignedInSection.classList.add('hidden');
          signedInSection.classList.remove('hidden');
          statusSection.classList.remove('hidden');
        } else {
          throw new Error('Failed to get user info');
        }
      } else {
        notSignedInSection.classList.remove('hidden');
        signedInSection.classList.add('hidden');
        statusSection.classList.add('hidden');
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      notSignedInSection.classList.remove('hidden');
      signedInSection.classList.add('hidden');
      statusSection.classList.add('hidden');
    }
  }
  
  async function handleSignIn() {
    try {
      await getAuthToken(true);
      checkAuthStatus();
    } catch (error) {
      console.error('Sign in error:', error);
      statusText.textContent = 'Authentication failed';
      statusIcon.style.backgroundColor = '#ea4335'; // Red
    }
  }
  
  async function handleSignOut() {
    try {
      const token = await getAuthToken(false);
      if (token) {
        // Revoke token
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        
        // Clear token from Chrome's cache
        chrome.identity.removeCachedAuthToken({ token });
        
        // Update UI
        notSignedInSection.classList.remove('hidden');
        signedInSection.classList.add('hidden');
        statusSection.classList.add('hidden');
      }
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }
  
  async function loadUpcomingMeetings() {
    try {
      const { upcomingEvents } = await chrome.storage.local.get('upcomingEvents');
      
      if (upcomingEvents && upcomingEvents.length > 0) {
        // Sort events by start time
        const sortedEvents = upcomingEvents.sort((a, b) => {
          const aStart = new Date(a.start.dateTime || a.start.date);
          const bStart = new Date(b.start.dateTime || b.start.date);
          return aStart - bStart;
        });
        
        // Clear existing list
        upcomingList.innerHTML = '';
        noMeetingsMsg.classList.add('hidden');
        
        // Add each event to the list
        sortedEvents.forEach(event => {
          const startTime = new Date(event.start.dateTime || event.start.date);
          const meetingItem = document.createElement('div');
          meetingItem.className = 'meeting-item';
          
          const meetingTitle = document.createElement('div');
          meetingTitle.className = 'meeting-title';
          meetingTitle.textContent = event.summary || 'Unnamed meeting';
          
          const meetingTime = document.createElement('div');
          meetingTime.className = 'meeting-time';
          meetingTime.textContent = formatTime(startTime);
          
          meetingItem.appendChild(meetingTitle);
          meetingItem.appendChild(meetingTime);
          upcomingList.appendChild(meetingItem);
        });
        
        // Update status
        statusText.textContent = 'Calendar monitoring active';
        statusIcon.style.backgroundColor = '#34a853'; // Green
      } else {
        upcomingList.innerHTML = '';
        noMeetingsMsg.classList.remove('hidden');
        
        // Update status if authenticated
        if (!notSignedInSection.classList.contains('hidden')) {
          statusText.textContent = 'No upcoming meetings with Meet links';
          statusIcon.style.backgroundColor = '#fbbc04'; // Yellow
        }
      }
    } catch (error) {
      console.error('Error loading upcoming meetings:', error);
      statusText.textContent = 'Error loading meetings';
      statusIcon.style.backgroundColor = '#ea4335'; // Red
    }
  }
  
  async function loadSettings() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      
      if (settings) {
        notificationTiming.value = settings.notificationTiming.toString();
        autoJoinCheckbox.checked = settings.autoJoin;
        ringtoneSelect.value = settings.ringtone;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }
  
  async function saveSettings() {
    try {
      const settings = {
        notificationTiming: parseInt(notificationTiming.value, 10),
        autoJoin: autoJoinCheckbox.checked,
        ringtone: ringtoneSelect.value
      };
      
      await chrome.storage.local.set({ settings });
      
      // Show saved confirmation
      saveSettingsButton.textContent = 'Saved!';
      setTimeout(() => {
        saveSettingsButton.textContent = 'Save Settings';
      }, 2000);
    } catch (error) {
      console.error('Error saving settings:', error);
      saveSettingsButton.textContent = 'Error Saving';
      setTimeout(() => {
        saveSettingsButton.textContent = 'Save Settings';
      }, 2000);
    }
  }
  
  async function testRingtone() {
    const ringtone = ringtoneSelect.value;
    let soundFile = 'assets/ring-default.mp3';
    
    switch (ringtone) {
      case 'classic':
        soundFile = 'assets/ring-classic.mp3';
        break;
      case 'digital':
        soundFile = 'assets/ring-digital.mp3';
        break;
      default:
        soundFile = 'assets/ring-default.mp3';
    }
    
    const audio = new Audio(chrome.runtime.getURL(soundFile));
    audio.play();
    
    // Stop after 3 seconds
    setTimeout(() => {
      audio.pause();
      audio.currentTime = 0;
    }, 3000);
  }
  
  function handleFirstRunContinue() {
    firstRunModal.classList.add('hidden');
    
    // Mark first run as complete
    chrome.storage.local.set({ firstRun: false });
    
    // Try to authenticate
    handleSignIn();
  }
  
  // Helper Functions
  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + 
           ' - ' + 
           new Date(date.getTime() + 30*60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, token => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });
  }
});
