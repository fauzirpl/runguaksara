// Application State
let state = {
  currentView: 'dashboard', // dashboard, create-session, session-details
  sessions: [],
  currentSession: null, // session details, transcripts, participants, minutes
  recording: {
    mediaRecorder: null,
    audioChunks: [],
    startTime: null,
    timerInterval: null,
    isRecording: false
  }
};

// Live Streaming WebSocket and Audio Context variables
let liveWs = null;
let liveAudioCtx = null;
let liveAudioSource = null;
let liveAudioProcessor = null;
let liveStream = null;
let liveTranscriptAccumulated = '';
let liveTranscriptCommitted = '';
let liveTranscriptActive = '';
let liveTranscriptOffset = '';
let liveAudioVisualizerId = null;

// VAD and Auto Cutoff variables
let silenceThreshold = 0.003; // default volume threshold
let silenceDurationLimit = 2000; // 2 seconds silence limit
let lastActiveTime = 0;
let lastCutOffTime = 0;
let isSilenceActive = true;

// WebSocket auto-reconnect variables
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimeoutId = null;
let isReconnecting = false;

// --- DOM Elements ---
const viewDashboard = document.getElementById('view-dashboard');
const viewCreateSession = document.getElementById('view-create-session');
const viewSessionDetails = document.getElementById('view-session-details');

const btnDashboard = document.getElementById('btn-dashboard');
const btnNewMeeting = document.getElementById('btn-new-meeting');
const btnBack = document.getElementById('btn-back');
const btnAddParticipant = document.getElementById('btn-add-participant');
const btnCancelCreate = document.getElementById('btn-cancel-create');
const btnTriggerUpload = document.getElementById('btn-trigger-upload');
const btnRecordMic = document.getElementById('btn-record-mic');
const btnGenerateMinutes = document.getElementById('btn-generate-minutes');
const btnSaveMinutes = document.getElementById('btn-save-minutes');
const btnExportWord = document.getElementById('btn-export-word');
const btnLogout = document.getElementById('btn-logout');

// Edit Session DOM Elements
const btnEditSession = document.getElementById('btn-edit-session');
const modalEditSession = document.getElementById('modal-edit-session');
const formEditSession = document.getElementById('form-edit-session');
const btnCloseEditModal = document.getElementById('btn-close-edit-modal');
const inputEditTitle = document.getElementById('input-edit-title');
const inputEditDate = document.getElementById('input-edit-date');
const inputEditLocation = document.getElementById('input-edit-location');
const inputEditAgenda = document.getElementById('input-edit-agenda');

// Profile DOM Elements
const btnProfile = document.getElementById('btn-profile');
const modalProfile = document.getElementById('modal-profile');
const formProfile = document.getElementById('form-profile');
const btnCloseProfileModal = document.getElementById('btn-close-profile-modal');
const userDisplayName = document.getElementById('user-display-name');
const inputProfileUsername = document.getElementById('input-profile-username');
const inputProfileFullname = document.getElementById('input-profile-fullname');
const inputProfileEmail = document.getElementById('input-profile-email');
const inputProfileOldPass = document.getElementById('input-profile-old-pass');
const inputProfileNewPass = document.getElementById('input-profile-new-pass');
const inputProfileConfirmPass = document.getElementById('input-profile-confirm-pass');

const formCreate = document.getElementById('form-create');
const searchInput = document.getElementById('search-sessions');
const fileAudioUpload = document.getElementById('file-audio-upload');
const participantsContainer = document.getElementById('participants-container');
const sessionsGrid = document.getElementById('sessions-grid');

// Recording DOMs
const recordCircle = document.getElementById('record-circle');
const recordStatus = document.getElementById('record-status');
const recordTimer = document.getElementById('record-timer');
const micVisualizer = document.getElementById('mic-visualizer');

// Live Speaker Switcher DOMs
const liveSpeakerContainer = document.getElementById('live-speaker-container');
const selectLiveSpeaker = document.getElementById('select-live-speaker');
const btnCutOff = document.getElementById('btn-cut-off');

// Details Panel DOMs
const sessionBadgeStatus = document.getElementById('session-badge-status');
const sessionDetailDate = document.getElementById('session-detail-date');
const sessionDetailTitle = document.getElementById('session-detail-title');
const sessionDetailLocation = document.getElementById('session-detail-location');
const sessionDetailParticipantsCount = document.getElementById('session-detail-participants-count');
const transcriptsList = document.getElementById('transcripts-list');
const transcriptCount = document.getElementById('transcript-count');

// Participants Panel DOMs
const participantsList = document.getElementById('participants-list');
const participantsCountBadge = document.getElementById('participants-count-badge');
const btnToggleAddParticipant = document.getElementById('btn-toggle-add-participant');
const addParticipantFormContainer = document.getElementById('add-participant-form-container');
const inputParticipantName = document.getElementById('input-participant-name');
const inputParticipantPosition = document.getElementById('input-participant-position');
const inputParticipantUnit = document.getElementById('input-participant-unit');
const btnSaveParticipant = document.getElementById('btn-save-participant');
const btnCancelAddParticipant = document.getElementById('btn-cancel-add-participant');

// Minutes Editor DOMs
const minutesContentArea = document.getElementById('minutes-content-area');
const minutesLoader = document.getElementById('minutes-loader');
const minutesEmptyState = document.getElementById('minutes-empty-state');
const minutesEditorContainer = document.getElementById('minutes-editor-container');
const minutesRichEditor = document.getElementById('minutes-rich-editor');
const actionItemsContainer = document.getElementById('action-items-container');
const actionItemsTbody = document.getElementById('action-items-tbody');
const actionGenerateContainer = document.getElementById('action-generate-container');

// Upload Progress DOMs
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadStatusLabel = document.getElementById('upload-status-label');
const uploadPercent = document.getElementById('upload-percent');
const uploadProgressBar = document.getElementById('upload-progress-bar');

// Toast
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastIconWrapper = document.getElementById('toast-icon-wrapper');

// --- Helper Functions ---

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Clean Gemini cumulative transcript from already cut off prefix
function getCleanTextChunk(textChunk, offset) {
  textChunk = (textChunk || '').trim();
  offset = (offset || '').trim();
  if (!offset) return textChunk;

  // Case 1: Exact prefix match
  if (textChunk.toLowerCase().startsWith(offset.toLowerCase())) {
    return textChunk.substring(offset.length).trim();
  }

  // Case 2: Fuzzy match or word-by-word comparison
  const chunkWords = textChunk.split(/\s+/);
  const offsetWords = offset.split(/\s+/);

  // If the offset is longer than the chunk, we cannot subtract. Return as is.
  if (offsetWords.length >= chunkWords.length) {
    return textChunk;
  }

  // Scan and align matching words from the beginning
  let bestMatchIndex = 0;
  for (let i = 0; i < Math.min(chunkWords.length, offsetWords.length); i++) {
    if (chunkWords[i].toLowerCase() === offsetWords[i].toLowerCase()) {
      bestMatchIndex = i + 1;
    } else {
      break;
    }
  }

  if (bestMatchIndex > 0) {
    return chunkWords.slice(bestMatchIndex).join(' ');
  }

  return textChunk;
}

// Show view
function switchView(viewName) {
  state.currentView = viewName;
  
  viewDashboard.classList.add('hidden');
  viewCreateSession.classList.add('hidden');
  viewSessionDetails.classList.add('hidden');
  
  if (viewName === 'dashboard') {
    viewDashboard.classList.remove('hidden');
    loadSessions();
  } else if (viewName === 'create-session') {
    viewCreateSession.classList.remove('hidden');
    resetCreateForm();
  } else if (viewName === 'session-details') {
    viewSessionDetails.classList.remove('hidden');
  }
}

// Toast notification
function showToast(message, type = 'success') {
  toastMessage.textContent = message;
  
  // Dynamic icon
  if (type === 'success') {
    toastIconWrapper.className = 'h-6 w-6 rounded-full flex items-center justify-center bg-emerald-500/10 text-emerald-400';
    toastIconWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>`;
  } else {
    toastIconWrapper.className = 'h-6 w-6 rounded-full flex items-center justify-center bg-red-500/10 text-red-400';
    toastIconWrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
  }
  
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 4000);
}

// --- App Controllers ---

// Load sessions
async function loadSessions() {
  sessionsGrid.innerHTML = `
    <div class="col-span-full py-20 flex flex-col items-center justify-center text-slate-500">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3E6AE1] mb-4"></div>
      <p class="text-sm">Memuat data rapat...</p>
    </div>
  `;
  
  loadStats();
  
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    state.sessions = data;
    renderSessions(data);
  } catch (err) {
    showToast('Gagal memuat data rapat.', 'error');
  }
}

// Render sessions list
function renderSessions(sessionsList) {
  if (sessionsList.length === 0) {
    sessionsGrid.innerHTML = `
      <div class="col-span-full py-20 bg-white border border-slate-200 rounded-[8px] flex flex-col items-center justify-center text-center p-8 text-slate-500">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
        <p class="text-sm font-medium">Belum ada sesi rapat terdokumentasi.</p>
        <p class="text-xs text-slate-500 max-w-xs mt-1">Buat rapat baru menggunakan tombol 'Rapat Baru' di atas.</p>
      </div>
    `;
    return;
  }
  
  sessionsGrid.innerHTML = sessionsList.map(s => {
    const statusColor = s.status === 'completed' 
      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' 
      : 'bg-amber-500/10 text-amber-700 border-amber-500/20';
    
    return `
      <div class="bg-white border border-slate-200 rounded-[8px] p-6 shadow-none hover:border-[#3E6AE1]/60 transition-colors duration-200 flex flex-col justify-between min-h-[220px]">
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs px-2.5 py-0.5 rounded-full font-medium border ${statusColor}">
              ${s.status === 'completed' ? 'Selesai' : 'Draf'}
            </span>
            <span class="text-xs text-slate-500">${s.date}</span>
          </div>
          <div>
            <h4 class="font-mono font-semibold text-base text-[#121212] line-clamp-2">${s.title}</h4>
            <p class="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-[#3E6AE1]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              ${s.location || 'Tidak ditentukan'}
            </p>
          </div>
          <p class="text-slate-650 text-xs line-clamp-2 leading-relaxed">${s.agenda || 'Tidak ada agenda tertulis.'}</p>
        </div>
        
        <div class="flex items-center justify-between border-t border-slate-100 pt-4 mt-4">
          <button onclick="viewSession('${s.id}')" class="px-4 py-2 bg-[#3E6AE1] hover:bg-[#2F5BD2] text-white rounded-[4px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer">
            Buka Workspace &rarr;
          </button>
          <button onclick="deleteSession('${s.id}')" class="p-2 text-slate-500 hover:text-red-650 rounded-[4px] hover:bg-red-50 transition-colors cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Reset create session form
function resetCreateForm() {
  formCreate.reset();
  participantsContainer.innerHTML = `
    <div class="grid grid-cols-12 gap-3 participant-row bg-slate-50/50 p-3 rounded-[8px] border border-slate-200">
      <input type="text" placeholder="Nama Peserta" class="col-span-5 bg-white border border-slate-200 focus:border-[#3E6AE1] focus:ring-4 focus:ring-[#3E6AE1]/5 focus:outline-none rounded-[4px] px-3 py-2 text-xs text-slate-800 transition-all duration-200" required>
      <input type="text" placeholder="Jabatan" class="col-span-4 bg-white border border-slate-200 focus:border-[#3E6AE1] focus:ring-4 focus:ring-[#3E6AE1]/5 focus:outline-none rounded-[4px] px-3 py-2 text-xs text-slate-800 transition-all duration-200">
      <input type="text" placeholder="Unit Kerja" class="col-span-2 bg-white border border-slate-200 focus:border-[#3E6AE1] focus:ring-4 focus:ring-[#3E6AE1]/5 focus:outline-none rounded-[4px] px-3 py-2 text-xs text-slate-800 transition-all duration-200" value="Internal">
      <button type="button" class="col-span-1 text-red-500 hover:text-red-650 flex items-center justify-center btn-remove-participant text-lg font-bold cursor-pointer">&times;</button>
    </div>
  `;
}

// Add participant row
function addParticipantRow() {
  const row = document.createElement('div');
  row.className = 'grid grid-cols-12 gap-3 participant-row bg-slate-50/50 p-3 rounded-[8px] border border-slate-200';
  row.innerHTML = `
    <input type="text" placeholder="Nama Peserta" class="col-span-5 bg-white border border-slate-200 focus:border-[#3E6AE1] focus:ring-4 focus:ring-[#3E6AE1]/5 focus:outline-none rounded-[4px] px-3 py-2 text-xs text-slate-800 transition-all duration-200" required>
    <input type="text" placeholder="Jabatan" class="col-span-4 bg-white border border-slate-200 focus:border-[#3E6AE1] focus:ring-4 focus:ring-[#3E6AE1]/5 focus:outline-none rounded-[4px] px-3 py-2 text-xs text-slate-800 transition-all duration-200">
    <input type="text" placeholder="Unit Kerja" class="col-span-2 bg-white border border-slate-200 focus:border-[#3E6AE1] focus:ring-4 focus:ring-[#3E6AE1]/5 focus:outline-none rounded-[4px] px-3 py-2 text-xs text-slate-800 transition-all duration-200" value="Internal">
    <button type="button" class="col-span-1 text-red-500 hover:text-red-650 flex items-center justify-center btn-remove-participant text-lg font-bold cursor-pointer">&times;</button>
  `;
  participantsContainer.appendChild(row);
}

// Delete session
window.deleteSession = async function(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus sesi rapat ini beserta semua transkrip dan notulensinya?')) {
    return;
  }
  
  try {
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('Sesi rapat berhasil dihapus.');
      loadSessions();
    } else {
      showToast('Gagal menghapus rapat.', 'error');
    }
  } catch (err) {
    showToast('Gagal menghapus rapat.', 'error');
  }
};

// View single session details
window.viewSession = async function(id) {
  try {
    const res = await fetch(`/api/sessions/${id}?t=${Date.now()}`);
    if (!res.ok) {
      showToast('Gagal membuka sesi rapat.', 'error');
      return;
    }
    const data = await res.json();
    state.currentSession = data;
    
    // Set headers
    sessionDetailTitle.textContent = data.session.title;
    sessionDetailDate.textContent = data.session.date;
    sessionDetailLocation.textContent = data.session.location || 'Tidak ditentukan';
    sessionDetailParticipantsCount.textContent = `${data.participants.length} Peserta`;
    
    // Set badge status
    const statusBadge = document.getElementById('session-badge-status');
    statusBadge.textContent = data.session.status === 'completed' ? 'Selesai' : 'Draf';
    statusBadge.className = data.session.status === 'completed'
      ? 'text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-250'
      : 'text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-250';

    renderTranscripts(data.transcripts);
    renderMinutes(data.minutes);
    renderParticipantsPanel(data.participants || []);
    
    switchView('session-details');
  } catch (err) {
    showToast('Gagal membuka sesi rapat.', 'error');
  }
};

// Render participants panel in session details view
function renderParticipantsPanel(participants) {
  participantsCountBadge.textContent = `${participants.length} Orang`;
  sessionDetailParticipantsCount.textContent = `${participants.length} Peserta`;

  if (participants.length === 0) {
    participantsList.innerHTML = `
      <div class="py-6 flex flex-col items-center justify-center text-center text-slate-500 text-xs">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-slate-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p>Belum ada peserta terdaftar.</p>
      </div>
    `;
    return;
  }

  const sessionId = state.currentSession.session.id;
  participantsList.innerHTML = participants.map((p, idx) => {
    const initials = p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['from-cyan-500 to-blue-500', 'from-emerald-500 to-teal-500', 'from-violet-500 to-purple-500',
      'from-amber-500 to-orange-500', 'from-pink-500 to-rose-500', 'from-indigo-500 to-cyan-500'];
    const color = colors[idx % colors.length];
    return `
      <div class="flex items-center gap-3 p-2.5 rounded-[8px] hover:bg-slate-100/80 transition-colors group">
        <div class="flex-shrink-0 h-8 w-8 rounded-full bg-gradient-to-br ${color} flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
          ${initials}
        </div>
        <div class="flex-grow min-w-0">
          <p class="text-sm font-semibold text-[#393C41] truncate">${escapeHtml(p.name)}</p>
          <p class="text-[10px] text-slate-500 truncate">${[escapeHtml(p.position), escapeHtml(p.unit)].filter(Boolean).join(' · ') || 'Tidak ada jabatan'}</p>
        </div>
        <button onclick="removeParticipant('${sessionId}', '${p.id}')"
          class="opacity-0 group-hover:opacity-100 p-1.5 text-slate-650 hover:text-red-600 hover:bg-red-50 rounded-[4px] transition-all cursor-pointer flex-shrink-0"
          title="Hapus peserta">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

// Remove a participant from the session
window.removeParticipant = async function(sessionId, participantId) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/participants/${participantId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      // Update local state
      state.currentSession.participants = state.currentSession.participants.filter(p => p.id !== participantId);
      renderParticipantsPanel(state.currentSession.participants);
      // Also refresh speaker dropdown if recording
      if (state.recording.isRecording) {
        renderLiveSpeakerPills();
      }
      showToast('Peserta berhasil dihapus dari rapat.');
    } else {
      showToast('Gagal menghapus peserta.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan saat menghapus peserta.', 'error');
  }
};

// Render transcripts list
function renderTranscripts(transcripts) {
  transcriptCount.textContent = `${transcripts.length} Segmen`;
  
  if (transcripts.length === 0) {
    if (state.recording.isRecording) {
      transcriptsList.innerHTML = '';
    } else {
      transcriptsList.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-center p-8 py-20 text-slate-500">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p class="text-sm font-semibold">Belum ada transkrip.</p>
          <p class="text-xs text-slate-500 max-w-xs mt-1 font-light">Gunakan perekam mic atau upload file audio di atas untuk menghasilkan transkrip rapat.</p>
        </div>
      `;
      actionGenerateContainer.classList.add('hidden');
      return;
    }
  } else {
    actionGenerateContainer.classList.remove('hidden');
  }
  
  // Render segments
  const participants = state.currentSession.participants;
  const transcriptsHtml = transcripts.map(t => {
    const speaker = t.speaker_label || 'Pembicara';
    const initials = speaker.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'P';
    const colors = ['from-cyan-500 to-blue-500', 'from-emerald-500 to-teal-500', 'from-violet-500 to-purple-500',
      'from-amber-500 to-orange-500', 'from-pink-500 to-rose-500', 'from-indigo-500 to-cyan-500'];
    const avatarColor = colors[Math.abs(speaker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % colors.length];
    return `      <div class="flex items-start gap-4 p-4 rounded-[8px] chat-bubble-left transition-all duration-200 hover:border-slate-350 group">
        <div class="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white text-xs font-bold shadow-md">
          ${initials}
        </div>
        <div class="flex-grow min-w-0 space-y-1.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-[#393C41]">${speaker}</span>
              <!-- Speaker correction dropdown -->
              <select onchange="updateSpeaker('${t.id}', this.value)" class="bg-white border border-slate-200 text-slate-650 hover:text-[#393C41] rounded-[4px] text-[10px] px-2 py-0.5 focus:outline-none focus:border-[#3E6AE1] focus:ring-2 focus:ring-[#3E6AE1]/10 transition-colors cursor-pointer">
                <option value="">Ganti Pembicara</option>
                ${participants.map(p => `<option value="${p.name}" ${t.speaker_label === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-slate-500 font-mono">${t.timestamp || ''}</span>
              <button onclick="deleteTranscript('${t.id}')" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 hover:bg-red-555/10 p-1.5 rounded transition-all cursor-pointer flex items-center justify-center" title="Hapus segmen">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          <p contenteditable="true" onblur="updateTranscriptText('${t.id}', this.innerText)" class="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap focus:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-[#3E6AE1]/20 rounded p-1 transition-all">${t.text}</p>
        </div>
      </div>
    `;
  }).join('');

  transcriptsList.innerHTML = transcriptsHtml;

  // Auto-render live container if recording is active
  if (state.recording.isRecording) {
    let liveContainer = document.getElementById('live-transcript-container');
    const activeSpeaker = document.getElementById('select-live-speaker').value || 'Pembicara';
    const liveInitials = activeSpeaker.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'P';
    if (!liveContainer) {
      liveContainer = document.createElement('div');
      liveContainer.id = 'live-transcript-container';
      liveContainer.className = 'flex items-start gap-4 p-4 rounded-[8px] chat-bubble-live animate-pulse';
      liveContainer.innerHTML = `
        <div class="flex-shrink-0 h-10 w-10 rounded-full bg-[#3E6AE1]/15 border border-[#3E6AE1]/20 flex items-center justify-center text-[#3E6AE1] text-xs font-bold shadow-sm">
          ${liveInitials}
        </div>
        <div class="flex-grow min-w-0 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold text-[#3E6AE1] live-speaker-header-label flex items-center gap-1.5">
              <span class="h-2 w-2 rounded-full bg-red-500 animate-ping"></span>
              ${activeSpeaker} (Live)
            </span>
            <span id="live-timer" class="text-[10px] text-[#3E6AE1] font-mono tracking-wider">${recordTimer.textContent || '00:00:00'}</span>
          </div>
          <p id="live-transcript-text" class="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-medium">${liveTranscriptAccumulated || ''}</p>
        </div>
      `;
      transcriptsList.appendChild(liveContainer);
    } else {
      transcriptsList.appendChild(liveContainer);
      const liveTextEl = document.getElementById('live-transcript-text');
      if (liveTextEl) liveTextEl.textContent = liveTranscriptAccumulated || '';
      const liveSpeakerHeader = liveContainer.querySelector('.live-speaker-header-label');
      if (liveSpeakerHeader) {
        liveSpeakerHeader.innerHTML = `<span class="h-2 w-2 rounded-full bg-red-500 animate-ping"></span> ${activeSpeaker} (Live)`;
      }
      const liveAvatar = liveContainer.querySelector('.flex-shrink-0');
      if (liveAvatar) {
        liveAvatar.textContent = liveInitials;
      }
    }
    transcriptsList.scrollTop = transcriptsList.scrollHeight;
  }
}

// Update Speaker Label
window.updateSpeaker = async function(transcriptId, val) {
  try {
    const res = await fetch(`/api/transcripts/${transcriptId}/speaker`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker_label: val })
    });
    const data = await res.json();
    if (data.success) {
      // Update local state speaker label
      const item = state.currentSession.transcripts.find(t => t.id === transcriptId);
      if (item) item.speaker_label = val;
      showToast('Label pembicara disimpan.');
      renderTranscripts(state.currentSession.transcripts);
    }
  } catch (err) {
    showToast('Gagal merubah label pembicara.', 'error');
  }
};

// Update Transcript Text Chunk Manually
window.updateTranscriptText = async function(transcriptId, val) {
  try {
    const res = await fetch(`/api/transcripts/${transcriptId}/text`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: val })
    });
    const data = await res.json();
    if (data.success) {
      // Update local state transcript text
      const item = state.currentSession.transcripts.find(t => t.id === transcriptId);
      if (item) item.text = val;
      showToast('Transkrip berhasil diperbarui.');
    }
  } catch (err) {
    showToast('Gagal merubah teks transkrip.', 'error');
  }
};

// Delete Transcript Chunk
window.deleteTranscript = async function(transcriptId) {
  if (transcriptId.startsWith('temp-')) {
    const element = document.querySelector(`[data-temp-id="${transcriptId}"]`);
    if (element) element.remove();
    showToast('Segmen transkrip dihapus.');
    return;
  }

  if (!confirm('Apakah Anda yakin ingin menghapus segmen transkrip ini?')) {
    return;
  }

  try {
    const res = await fetch(`/api/transcripts/${transcriptId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      // Remove from local state
      state.currentSession.transcripts = state.currentSession.transcripts.filter(t => t.id !== transcriptId);
      // Re-render
      renderTranscripts(state.currentSession.transcripts);
      showToast('Segmen transkrip berhasil dihapus.');
    } else {
      showToast('Gagal menghapus segmen transkrip.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan saat menghapus segmen transkrip.', 'error');
  }
};

// Render Minutes (Notulensi) Preview / Editor
function renderMinutes(minutes) {
  minutesLoader.classList.add('hidden');
  btnExportWord.classList.add('hidden');
  minutesEmptyState.classList.remove('hidden');
  minutesEditorContainer.classList.add('hidden');
  actionItemsContainer.classList.add('hidden');
  btnSaveMinutes.classList.add('hidden');

  if (!minutes) return;

  btnExportWord.classList.remove('hidden');
  minutesEmptyState.classList.add('hidden');
  minutesEditorContainer.classList.remove('hidden');
  btnSaveMinutes.classList.remove('hidden');

  // Load editor content
  minutesRichEditor.innerHTML = minutes.notes_html;

  // Render Action Items table
  if (minutes.actionItems && minutes.actionItems.length > 0) {
    actionItemsContainer.classList.remove('hidden');
    actionItemsTbody.innerHTML = minutes.actionItems.map(item => {
      const isDone = item.status === 'done';
      return `
        <tr class="border-b border-slate-200 hover:bg-slate-50 transition-colors">
          <td class="py-2.5 pr-2 font-medium text-slate-800 leading-normal ${isDone ? 'line-through text-slate-405' : ''}">${item.description}</td>
          <td class="py-2.5 px-2 font-semibold text-[#3E6AE1] whitespace-nowrap">${item.pic}</td>
          <td class="py-2.5 px-2 text-slate-500">${item.due_date}</td>
          <td class="py-2.5 pl-2 text-right">
            <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleActionItemStatus('${item.id}', this.checked)" class="w-4 h-4 rounded border-slate-350 bg-white text-[#3E6AE1] focus:ring-[#3E6AE1]/20 cursor-pointer">
          </td>
        </tr>
      `;
    }).join('');
  }
}

// Generate Notulensi AI
async function generateMinutes() {
  const id = state.currentSession.session.id;
  
  actionGenerateContainer.classList.add('hidden');
  minutesEmptyState.classList.add('hidden');
  minutesLoader.classList.remove('hidden');
  
  try {
    const res = await fetch(`/api/sessions/${id}/generate-minutes`, { method: 'POST' });
    const data = await res.json();
    
    if (data.error) {
      showToast(data.error, 'error');
      actionGenerateContainer.classList.remove('hidden');
      minutesLoader.classList.add('hidden');
      minutesEmptyState.classList.remove('hidden');
      return;
    }
    
    // Refresh session data
    await refreshSession(id);
    showToast('Notulensi cerdas berhasil disusun oleh AI.');
  } catch (err) {
    showToast('Gagal generate notulensi rapat.', 'error');
    actionGenerateContainer.classList.remove('hidden');
    minutesLoader.classList.add('hidden');
    minutesEmptyState.classList.remove('hidden');
  }
}

// Refresh Single Session data
async function refreshSession(id) {
  const res = await fetch(`/api/sessions/${id}?t=${Date.now()}`);
  const data = await res.json();
  state.currentSession = data;
  renderTranscripts(data.transcripts);
  renderMinutes(data.minutes);
  renderParticipantsPanel(data.participants || []);
}

// Save Manual Changes in Editor
async function saveMinutes() {
  const id = state.currentSession.session.id;
  const contentHtml = minutesRichEditor.innerHTML;
  
  try {
    const res = await fetch(`/api/sessions/${id}/minutes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes_html: contentHtml,
        actionItems: state.currentSession.minutes.actionItems // Keep same action items for now
      })
    });
    
    const data = await res.json();
    if (data.success) {
      showToast('Perubahan notulensi berhasil disimpan.');
      refreshSession(id);
    } else {
      showToast('Gagal menyimpan perubahan.', 'error');
    }
  } catch (err) {
    showToast('Gagal menyimpan perubahan.', 'error');
  }
}

// --- Audio Upload Logic ---
async function uploadAudioFile(file) {
  const id = state.currentSession.session.id;
  
  uploadProgressContainer.classList.remove('hidden');
  uploadStatusLabel.textContent = 'Mengunggah & memproses audio...';
  uploadPercent.textContent = '0%';
  uploadProgressBar.style.width = '0%';

  const formData = new FormData();
  formData.append('audio', file);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sessions/${id}/transcribe`, true);
    
    // Track upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        // Cap visual progress at 95% while waiting for API backend transcription
        const visualPercent = Math.min(percent, 95);
        uploadPercent.textContent = `${visualPercent}%`;
        uploadProgressBar.style.width = `${visualPercent}%`;
        if (visualPercent === 95) {
          uploadStatusLabel.textContent = 'Memproses transkripsi AI (Whisper)...';
        }
      }
    };

    xhr.onload = async () => {
      uploadPercent.textContent = '100%';
      uploadProgressBar.style.width = '100%';
      
      setTimeout(() => {
        uploadProgressContainer.classList.add('hidden');
      }, 1000);

      if (xhr.status === 200) {
        showToast('Transkripsi berhasil diselesaikan.');
        refreshSession(id);
      } else {
        const errObj = JSON.parse(xhr.responseText || '{}');
        showToast(errObj.error || 'Gagal memproses audio.', 'error');
      }
    };

    xhr.onerror = () => {
      uploadProgressContainer.classList.add('hidden');
      showToast('Terjadi kesalahan jaringan saat mengunggah.', 'error');
    };

    xhr.send(formData);
  } catch (err) {
    uploadProgressContainer.classList.add('hidden');
    showToast('Gagal mengunggah rekaman.', 'error');
  }
}

// --- Mic / Tab Recording Core (WebSocket Live Streaming) ---
// Add transcript block optimistically to the UI before saving to database
function addOptimisticTranscript(text, speakerName) {
  const transcriptsList = document.getElementById('transcripts-list');
  const liveContainer = document.getElementById('live-transcript-container');
  if (!transcriptsList) return;

  // Remove empty state if present
  const emptyState = transcriptsList.querySelector('.text-slate-500');
  if (emptyState && emptyState.textContent.includes('Belum ada transkrip')) {
    emptyState.remove();
  }

  const timestamp = new Date().toLocaleTimeString('id-ID');
  const initials = speakerName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'P';
  const colors = ['from-cyan-500 to-blue-500', 'from-emerald-500 to-teal-500', 'from-violet-500 to-purple-500',
    'from-amber-500 to-orange-500', 'from-pink-500 to-rose-500', 'from-indigo-500 to-cyan-500'];
  const avatarColor = colors[Math.abs(speakerName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % colors.length];

  const participants = state.currentSession?.participants || [];
  const dropdownOptions = participants.map(p => `<option value="${p.name}" ${speakerName === p.name ? 'selected' : ''}>${p.name}</option>`).join('');
  const tempId = `temp-${Date.now()}`;

  const bubbleHtml = `    <div class="flex items-start gap-4 p-4 rounded-[8px] chat-bubble-left transition-all duration-200 hover:border-slate-350 group" data-temp-id="${tempId}">
      <div class="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center text-white text-xs font-bold shadow-md">
        ${initials}
      </div>
      <div class="flex-grow min-w-0 space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-[#393C41]">${speakerName}</span>
            <select onchange="updateSpeaker('${tempId}', this.value)" class="bg-white border border-slate-200 text-slate-650 hover:text-[#393C41] rounded-[4px] text-[10px] px-2 py-0.5 focus:outline-none focus:border-[#3E6AE1] focus:ring-2 focus:ring-[#3E6AE1]/10 transition-colors cursor-pointer">
              <option value="">Ganti Pembicara</option>
              ${dropdownOptions}
            </select>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-slate-500 font-mono">${timestamp}</span>
            <button onclick="deleteTranscript('${tempId}')" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 hover:bg-red-555/10 p-1.5 rounded transition-all cursor-pointer flex items-center justify-center" title="Hapus segmen">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
        <p contenteditable="true" onblur="updateTranscriptText('${tempId}', this.innerText)" class="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap focus:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-[#3E6AE1]/20 rounded p-1 transition-all">${escapeHtml(text)}</p>
      </div>
    </div>
  `;

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = bubbleHtml.trim();
  const bubbleElement = tempDiv.firstChild;

  if (liveContainer) {
    transcriptsList.insertBefore(bubbleElement, liveContainer);
  } else {
    transcriptsList.appendChild(bubbleElement);
  }

  // Ensure 'Generate Minutes' action button container is visible
  const actionGenerateContainer = document.getElementById('action-generate-container');
  if (actionGenerateContainer) {
    actionGenerateContainer.classList.remove('hidden');
  }

  transcriptsList.scrollTop = transcriptsList.scrollHeight;
}

async function saveLiveTranscript(text, speakerLabel = '') {
  const id = state.currentSession.session.id;
  try {
    const res = await fetch(`/api/sessions/${id}/live-transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, speaker_label: speakerLabel })
    });
    if (res.ok) {
      showToast(`Segmen transkrip${speakerLabel ? ` (${speakerLabel})` : ''} berhasil disimpan.`);
      await refreshSession(id);
    } else {
      showToast('Gagal menyimpan transkrip ke database.', 'error');
    }
  } catch (err) {
    console.error('Error saving live transcript:', err);
    showToast('Terjadi kesalahan saat menyimpan transkrip.', 'error');
  }
}

async function triggerSilenceCutOff() {
  const textToSave = liveTranscriptAccumulated.trim();
  const speaker = document.getElementById('select-live-speaker').value || '';

  if (!textToSave) return;

  // Add the saved text to the offset so it gets removed from the cumulative Gemini transcript
  liveTranscriptOffset += (liveTranscriptOffset ? " " : "") + textToSave;

  // Reset segment state so next transcript starts fresh
  liveTranscriptAccumulated = '';
  liveTranscriptCommitted = '';
  liveTranscriptActive = '';

  const liveTextEl = document.getElementById('live-transcript-text');
  if (liveTextEl) liveTextEl.textContent = '';

  // Add block optimistically to transcripts list immediately
  addOptimisticTranscript(textToSave, speaker);

  lastCutOffTime = Date.now();
  await saveLiveTranscript(textToSave, speaker);
}

async function startRecording() {
  if (state.recording.isRecording) return;

  const audioSourceSelect = document.getElementById('select-audio-source').value;
  liveTranscriptAccumulated = '';
  liveTranscriptCommitted = '';
  liveTranscriptActive = '';
  liveTranscriptOffset = '';

  lastActiveTime = Date.now();
  lastCutOffTime = Date.now();
  isSilenceActive = true;

  // Populate and show the speaker pills
  renderLiveSpeakerPills();
  liveSpeakerContainer.classList.remove('hidden');

  try {
    if (audioSourceSelect === 'system') {
      liveStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 10, height: 10 }, // Request small video to trigger dialog and satisfy WebRTC spec
        audio: true
      });
      
      if (liveStream.getAudioTracks().length === 0) {
        showToast('Suara sistem tidak dibagikan. Harap centang "Bagikan audio" (Share audio).', 'error');
        liveStream.getTracks().forEach(t => t.stop());
        return;
      }
    } else {
      liveStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/sessions/${state.currentSession.session.id}/live`;
    
    reconnectAttempts = 0;
    isReconnecting = false;
    setupWebSocketConnection(wsUrl);

  } catch (err) {
    console.error('Failed to capture audio or connect WS:', err);
    showToast('Izin akses ditolak atau browser tidak mendukung perekaman jenis ini.', 'error');
    if (liveStream) {
      liveStream.getTracks().forEach(t => t.stop());
    }
  }
}

function setupWebSocketConnection(wsUrl) {
  liveWs = new WebSocket(wsUrl);

  liveWs.onopen = async () => {
    console.log('Browser WebSocket to server opened');
    if (isReconnecting) {
      isReconnecting = false;
      reconnectAttempts = 0;
      showToast('Koneksi Live API terhubung kembali!');
      recordStatus.textContent = 'Streaming Real-time...';
      recordStatus.classList.remove('text-amber-600');
      recordStatus.classList.add('text-[#3E6AE1]', 'animate-pulse');
    } else {
      showToast('Terhubung ke Live API. Mulai merekam...');
      
      liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      liveAudioSource = liveAudioCtx.createMediaStreamSource(liveStream);
      
      // Real-time Audio Visualizer Analyser Setup
      const analyser = liveAudioCtx.createAnalyser();
      analyser.fftSize = 32;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      liveAudioSource.connect(analyser);
      
      const visualizerBars = micVisualizer.querySelectorAll('span');
      visualizerBars.forEach((bar, idx) => {
        bar.classList.remove(`animate-bar-${idx + 1}`);
      });

      function drawVisualizer() {
        if (!state.recording.isRecording) return;
        liveAudioVisualizerId = requestAnimationFrame(drawVisualizer);
        analyser.getByteFrequencyData(dataArray);
        
        const binIndices = [1, 2, 4, 6, 8];
        visualizerBars.forEach((bar, idx) => {
          const binValue = dataArray[binIndices[idx]] || 0;
          const minHeight = 4;
          const maxHeight = 26;
          const scale = binValue / 255;
          const height = minHeight + (scale * (maxHeight - minHeight));
          bar.style.height = `${height}px`;
        });
      }
      
      drawVisualizer();

      // Shared audio processing function
      const processAudio = (inputData) => {
        // Calculate RMS to detect silence volume
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        // Get VAD and Auto Cutoff settings from DOM
        const chkAutoSilence = document.getElementById('chk-auto-cutoff-silence');
        const chkAutoTime = document.getElementById('chk-auto-cutoff-time');

        const autoSilence = chkAutoSilence ? chkAutoSilence.checked : true;
        const autoTime = chkAutoTime ? chkAutoTime.checked : true;

        if (rms < silenceThreshold) {
          // Silence detected
          if (autoSilence) {
            const timeSinceActive = Date.now() - lastActiveTime;
            // If silence duration limit has passed (2 seconds) and there is text to save, trigger automatic cutoff
            if (timeSinceActive > silenceDurationLimit && liveTranscriptAccumulated.trim() && !isSilenceActive) {
              isSilenceActive = true;
              triggerSilenceCutOff();
            }
          }
        } else {
          // Speech detected!
          lastActiveTime = Date.now();
          isSilenceActive = false;
        }

        // Periodic Auto Cutoff (every 30 seconds)
        if (autoTime) {
          const timeSinceCutoff = Date.now() - lastCutOffTime;
          if (timeSinceCutoff > 30000 && liveTranscriptAccumulated.trim()) {
            triggerSilenceCutOff();
          }
        }

        const pcmBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let val = Math.floor(inputData[i] * 0x7FFF);
          val = Math.max(-32768, Math.min(32767, val));
          pcmBuffer[i] = val;
        }
        
        if (liveWs && liveWs.readyState === WebSocket.OPEN) {
          liveWs.send(pcmBuffer.buffer);
        }
      };

      // Load AudioWorklet or fallback to ScriptProcessor Node
      let isWorkletInitialized = false;
      if (liveAudioCtx.audioWorklet && typeof liveAudioCtx.audioWorklet.addModule === 'function') {
        try {
          await liveAudioCtx.audioWorklet.addModule('audio-processor.js');
          liveAudioProcessor = new AudioWorkletNode(liveAudioCtx, 'audio-processor');
          
          liveAudioSource.connect(liveAudioProcessor);
          liveAudioProcessor.connect(liveAudioCtx.destination);
          
          // Accumulate 128-sample chunks from AudioWorklet into a 2048-sample buffer
          // to align volume threshold check & VAD matching with ScriptProcessor's window.
          let audioAccumulator = new Float32Array(2048);
          let accumulatorIndex = 0;
          
          liveAudioProcessor.port.onmessage = (e) => {
            if (!state.recording.isRecording) return;
            
            const inputChunks = e.data;
            let chunkIndex = 0;
            
            while (chunkIndex < inputChunks.length) {
              const remainingSpace = 2048 - accumulatorIndex;
              const chunkRemaining = inputChunks.length - chunkIndex;
              const copyLength = Math.min(remainingSpace, chunkRemaining);
              
              audioAccumulator.set(inputChunks.subarray(chunkIndex, chunkIndex + copyLength), accumulatorIndex);
              
              accumulatorIndex += copyLength;
              chunkIndex += copyLength;
              
              if (accumulatorIndex === 2048) {
                // Process the filled 2048-sample block
                processAudio(audioAccumulator);
                // Reset index but keep allocation
                accumulatorIndex = 0;
              }
            }
          };
          
          isWorkletInitialized = true;
          console.log('AudioWorkletNode initialized successfully with 2048-sample accumulator');
        } catch (workletErr) {
          console.warn('Failed to load AudioWorklet, falling back to ScriptProcessor:', workletErr);
        }
      }

      if (!isWorkletInitialized) {
        liveAudioProcessor = liveAudioCtx.createScriptProcessor(2048, 1, 1);
        
        liveAudioSource.connect(liveAudioProcessor);
        liveAudioProcessor.connect(liveAudioCtx.destination);
        
        liveAudioProcessor.onaudioprocess = (e) => {
          if (!state.recording.isRecording) return;
          const inputData = e.inputBuffer.getChannelData(0);
          processAudio(inputData);
        };
        console.log('ScriptProcessorNode fallback initialized');
      }

      state.recording.isRecording = true;
      state.recording.startTime = Date.now();
      
      recordCircle.classList.remove('bg-red-50', 'border-red-200/50');
      recordCircle.classList.add('bg-blue-50', 'border-[#3E6AE1]/20', 'scale-110');
      btnRecordMic.classList.remove('bg-red-650', 'hover:bg-red-700');
      btnRecordMic.classList.add('bg-[#3E6AE1]', 'hover:bg-[#2F5BD2]');
      
      recordStatus.textContent = 'Streaming Real-time...';
      recordStatus.classList.add('text-[#3E6AE1]', 'animate-pulse');
      micVisualizer.classList.remove('hidden');
      
      // Call renderTranscripts to automatically inject empty live container
      renderTranscripts(state.currentSession.transcripts);

      state.recording.timerInterval = setInterval(() => {
        const elapsed = Date.now() - state.recording.startTime;
        const sec = Math.floor((elapsed / 1000) % 60);
        const min = Math.floor((elapsed / (1000 * 60)) % 60);
        const hr = Math.floor(elapsed / (1000 * 60 * 60));
        
        const timerStr = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        recordTimer.textContent = timerStr;
        
        const liveTimer = document.getElementById('live-timer');
        if (liveTimer) liveTimer.textContent = timerStr;
      }, 1000);
    }
  };

  liveWs.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'transcript') {
        const textChunk = payload.text.trim();
        if (!textChunk) return;

        const cleanTextChunk = getCleanTextChunk(textChunk, liveTranscriptOffset);
        if (!cleanTextChunk) return;

        const liveTextEl = document.getElementById('live-transcript-text');
        if (liveTextEl) {
          const getFirstWord = (str) => str.trim().split(/\s+/)[0].toLowerCase();
          const prevFirstWord = getFirstWord(liveTranscriptActive);
          const newFirstWord = getFirstWord(cleanTextChunk);
          
          if (liveTranscriptActive && (
            (prevFirstWord && newFirstWord && prevFirstWord !== newFirstWord) ||
            (cleanTextChunk.length < liveTranscriptActive.length)
          )) {
            liveTranscriptCommitted += (liveTranscriptCommitted ? " " : "") + liveTranscriptActive;
          }
          
          liveTranscriptActive = cleanTextChunk;
          liveTranscriptAccumulated = liveTranscriptCommitted + (liveTranscriptCommitted ? " " : "") + liveTranscriptActive;
          
          liveTextEl.textContent = liveTranscriptAccumulated;
          transcriptsList.scrollTop = transcriptsList.scrollHeight;
        }
      } else if (payload.type === 'error') {
        console.error('Server error:', payload.message);
        showToast(payload.message, 'error');
      }
    } catch (err) {
      console.error('Error parsing WS message:', err);
    }
  };

  liveWs.onclose = (event) => {
    console.log(`Browser WebSocket closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
    if (state.recording.isRecording) {
      attemptWebSocketReconnect(wsUrl);
    }
  };

  liveWs.onerror = (err) => {
    console.error('Browser WebSocket error:', err);
  };
}

function attemptWebSocketReconnect(wsUrl) {
  if (!state.recording.isRecording) return;
  
  reconnectAttempts++;
  if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
    isReconnecting = true;
    
    recordStatus.textContent = `Menghubungkan kembali... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
    recordStatus.classList.remove('text-[#3E6AE1]');
    recordStatus.classList.add('text-amber-600');
    
    showToast(`Koneksi terputus. Mencoba menghubungkan kembali... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'error');
    
    reconnectTimeoutId = setTimeout(() => {
      if (state.recording.isRecording) {
        setupWebSocketConnection(wsUrl);
      }
    }, 3000);
  } else {
    showToast('Gagal terhubung kembali setelah 5 kali percobaan. Perekaman dihentikan.', 'error');
    stopRecording();
  }
}

function stopRecording() {
  if (!state.recording.isRecording) return;
  
  state.recording.isRecording = false;
  clearInterval(state.recording.timerInterval);

  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  isReconnecting = false;
  reconnectAttempts = 0;

  const finalLiveText = liveTranscriptAccumulated.trim();
  const activeSpeaker = selectLiveSpeaker.value || '';
  
  liveTranscriptOffset = '';

  if (finalLiveText) {
    saveLiveTranscript(finalLiveText, activeSpeaker);
  } else {
    refreshSession(state.currentSession.session.id);
  }
  
  liveSpeakerContainer.classList.add('hidden');

  if (liveWs) {
    try {
      liveWs.send(JSON.stringify({ type: 'stop' }));
      liveWs.close();
    } catch (e) {
      console.error(e);
    }
  }

  if (liveStream) {
    try {
      liveStream.getTracks().forEach(track => track.stop());
    } catch (e) {
      console.error(e);
    }
  }

  if (liveAudioVisualizerId) {
    cancelAnimationFrame(liveAudioVisualizerId);
    liveAudioVisualizerId = null;
  }

  if (liveAudioProcessor) {
    try { liveAudioProcessor.disconnect(); } catch (e) {}
  }
  if (liveAudioSource) {
    try { liveAudioSource.disconnect(); } catch (e) {}
  }
  if (liveAudioCtx) {
    try { liveAudioCtx.close(); } catch (e) {}
  }

  const visualizerBars = micVisualizer.querySelectorAll('span');
  visualizerBars.forEach((bar, idx) => {
    bar.style.height = '';
    bar.classList.add(`animate-bar-${idx + 1}`);
  });

  const liveContainer = document.getElementById('live-transcript-container');
  if (liveContainer) {
    liveContainer.remove();
  }
  
  recordCircle.classList.add('bg-red-50', 'border-red-200/50');
  recordCircle.classList.remove('bg-blue-50', 'border-[#3E6AE1]/20', 'scale-110');
  btnRecordMic.classList.add('bg-red-650', 'hover:bg-red-700');
  btnRecordMic.classList.remove('bg-[#3E6AE1]', 'hover:bg-[#2F5BD2]');
  
  recordStatus.textContent = 'Mulai Rekam Suara';
  recordStatus.classList.remove('text-[#3E6AE1]', 'animate-pulse');
  micVisualizer.classList.add('hidden');
}

// --- Event Listeners ---

// Navigation
btnDashboard.addEventListener('click', () => switchView('dashboard'));
btnNewMeeting.addEventListener('click', () => switchView('create-session'));
btnCancelCreate.addEventListener('click', () => switchView('dashboard'));
btnBack.addEventListener('click', () => switchView('dashboard'));

// Add dynamic participant row
btnAddParticipant.addEventListener('click', addParticipantRow);

// Remove participant row handler
participantsContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('btn-remove-participant')) {
    const row = e.target.closest('.participant-row');
    if (row && participantsContainer.children.length > 1) {
      row.remove();
    } else {
      showToast('Rapat membutuhkan minimal 1 peserta.', 'error');
    }
  }
});

// Create Session Form Submit
formCreate.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const title = document.getElementById('input-title').value.trim();
  const date = document.getElementById('input-date').value;
  const location = document.getElementById('input-location').value.trim();
  const agenda = document.getElementById('input-agenda').value.trim();
  
  // Extract participants
  const rows = participantsContainer.querySelectorAll('.participant-row');
  const participants = Array.from(rows).map(row => {
    const inputs = row.querySelectorAll('input');
    return {
      name: inputs[0].value.trim(),
      position: inputs[1].value.trim(),
      unit: inputs[2].value.trim()
    };
  }).filter(p => p.name !== '');

  const payload = { title, date, location, agenda, participants };
  
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      const data = await res.json();
      showToast('Sesi rapat baru berhasil dibuat.');
      viewSession(data.id);
    } else {
      showToast('Gagal membuat sesi rapat.', 'error');
    }
  } catch (err) {
    showToast('Gagal membuat sesi rapat.', 'error');
  }
});

// Search input handler
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  const filtered = state.sessions.filter(s => 
    s.title.toLowerCase().includes(query) || 
    (s.agenda && s.agenda.toLowerCase().includes(query)) ||
    (s.location && s.location.toLowerCase().includes(query))
  );
  renderSessions(filtered);
});

// Audio upload handlers
btnTriggerUpload.addEventListener('click', () => fileAudioUpload.click());
fileAudioUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    uploadAudioFile(file);
    // Reset file input value so same file can trigger change again if needed
    fileAudioUpload.value = '';
  }
});

// Recording Handlers
btnRecordMic.addEventListener('click', () => {
  if (state.recording.isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// Cut Off: save current accumulated transcript under selected speaker and reset segment
btnCutOff.addEventListener('click', async () => {
  await triggerSilenceCutOff();
});

// Generate Minutes Handler
btnGenerateMinutes.addEventListener('click', generateMinutes);

// Save Minutes changes manually
btnSaveMinutes.addEventListener('click', saveMinutes);

// Export Word doc
btnExportWord.addEventListener('click', () => {
  if (!state.currentSession || !state.currentSession.session) return;
  const id = state.currentSession.session.id;
  window.open(`/api/sessions/${id}/export`, '_blank');
});

// Logout click listener
btnLogout.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/logout', { method: 'POST' });
    if (res.ok) {
      window.location.href = '/login.html';
    }
  } catch (err) {
    showToast('Gagal keluar dari aplikasi.', 'error');
  }
});

// Participant Panel: toggle add form
btnToggleAddParticipant.addEventListener('click', () => {
  const isHidden = addParticipantFormContainer.classList.toggle('hidden');
  btnToggleAddParticipant.innerHTML = isHidden
    ? `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg> Tambah Peserta`
    : `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg> Tutup Form`;
  if (!isHidden) inputParticipantName.focus();
});

// Participant Panel: cancel
btnCancelAddParticipant.addEventListener('click', () => {
  addParticipantFormContainer.classList.add('hidden');
  btnToggleAddParticipant.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg> Tambah Peserta`;
  inputParticipantName.value = '';
  inputParticipantPosition.value = '';
  inputParticipantUnit.value = 'Internal';
});

// Participant Panel: save new participant
btnSaveParticipant.addEventListener('click', async () => {
  const name = inputParticipantName.value.trim();
  if (!name) {
    showToast('Nama peserta tidak boleh kosong.', 'error');
    inputParticipantName.focus();
    return;
  }

  if (!state.currentSession) return;
  const sessionId = state.currentSession.session.id;

  btnSaveParticipant.disabled = true;
  btnSaveParticipant.textContent = 'Menyimpan...';

  try {
    const res = await fetch(`/api/sessions/${sessionId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        position: inputParticipantPosition.value.trim(),
        unit: inputParticipantUnit.value.trim() || 'Internal'
      })
    });
    const data = await res.json();

    if (res.ok) {
      // Add to local state and re-render
      state.currentSession.participants.push(data);
      renderParticipantsPanel(state.currentSession.participants);
      // Also refresh speaker dropdown if recording
      if (state.recording.isRecording) {
        renderLiveSpeakerPills();
      }
      showToast(`${name} berhasil ditambahkan ke rapat.`);
      // Reset & close form
      inputParticipantName.value = '';
      inputParticipantPosition.value = '';
      inputParticipantUnit.value = 'Internal';
      addParticipantFormContainer.classList.add('hidden');
      btnToggleAddParticipant.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg> Tambah Peserta`;
    } else {
      showToast(data.error || 'Gagal menambahkan peserta.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan saat menyimpan peserta.', 'error');
  } finally {
    btnSaveParticipant.disabled = false;
    btnSaveParticipant.textContent = 'Simpan Peserta';
  }
});

// Allow Enter key to submit from name field
inputParticipantName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnSaveParticipant.click();
});

// Toggle Action Item Status API Caller
window.toggleActionItemStatus = async function(id, isChecked) {
  const status = isChecked ? 'done' : 'pending';
  try {
    const res = await fetch(`/api/action-items/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      showToast('Status tugas berhasil diperbarui.');
      if (state.currentSession && state.currentSession.minutes && state.currentSession.minutes.actionItems) {
        const item = state.currentSession.minutes.actionItems.find(a => a.id === id);
        if (item) {
          item.status = status;
          renderMinutes(state.currentSession.minutes);
        }
      }
    } else {
      showToast('Gagal memperbarui status tugas.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan saat memperbarui status tugas.', 'error');
  }
};

// Global Hotkeys Keyboard Listener for fast speaker Switch & Cut Off
document.addEventListener('keydown', (e) => {
  if (!state.recording.isRecording) return;

  // Skip hotkeys if user is editing inputs or contenteditable area
  const activeEl = document.activeElement;
  if (activeEl && (
    activeEl.tagName === 'INPUT' || 
    activeEl.tagName === 'TEXTAREA' || 
    activeEl.isContentEditable
  )) {
    return;
  }

  // Key matches 1-9
  if (e.key >= '1' && e.key <= '9') {
    const speakerIdx = parseInt(e.key) - 1;
    const participants = state.currentSession?.participants || [];
    if (speakerIdx < participants.length) {
      e.preventDefault();
      const selectedSpeaker = participants[speakerIdx].name;
      // Triggers active speaker switch & Cut Off automatically!
      setActiveSpeakerAndCutOff(selectedSpeaker);
    }
  }
});

// Edit Session Modal Event Listeners
btnEditSession.addEventListener('click', () => {
  if (!state.currentSession || !state.currentSession.session) return;
  const s = state.currentSession.session;
  
  inputEditTitle.value = s.title || '';
  inputEditDate.value = s.date || '';
  inputEditLocation.value = s.location || '';
  inputEditAgenda.value = s.agenda || '';
  
  modalEditSession.classList.remove('hidden');
});

btnCloseEditModal.addEventListener('click', () => {
  modalEditSession.classList.add('hidden');
});

modalEditSession.addEventListener('click', (e) => {
  if (e.target === modalEditSession) {
    modalEditSession.classList.add('hidden');
  }
});

formEditSession.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  if (!state.currentSession || !state.currentSession.session) return;
  const id = state.currentSession.session.id;
  
  const payload = {
    title: inputEditTitle.value.trim(),
    date: inputEditDate.value,
    location: inputEditLocation.value.trim(),
    agenda: inputEditAgenda.value.trim()
  };
  
  try {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast('Detail rapat berhasil diperbarui.');
      modalEditSession.classList.add('hidden');
      await refreshSession(id);
    } else {
      const data = await res.json();
      showToast(data.error || 'Gagal memperbarui detail rapat.', 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan saat memperbarui detail rapat.', 'error');
  }
});

// Load Dashboard Bento Stats
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('stat-sessions-count').textContent = data.sessions;
      document.getElementById('stat-transcripts-count').textContent = data.transcripts;
      
      const totalActions = data.actionItems.total;
      const doneActions = data.actionItems.done;
      const percent = totalActions > 0 ? Math.round((doneActions / totalActions) * 100) : 0;
      
      document.getElementById('stat-actions-percent').textContent = `${percent}%`;
      document.getElementById('stat-actions-fraction').textContent = `${doneActions} dari ${totalActions} tugas selesai`;
    }
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

// Helper to render live speaker pills
window.renderLiveSpeakerPills = function() {
  const participants = state.currentSession?.participants || [];
  const pillsContainer = document.getElementById('live-speaker-pills');
  if (!pillsContainer) return;

  if (participants.length > 0) {
    pillsContainer.innerHTML = participants.map((p, idx) => {
      return `
        <button type="button" 
          data-speaker="${encodeURIComponent(p.name)}"
          id="speaker-pill-${idx}"
          class="speaker-pill px-3 py-1.5 border border-slate-200 bg-white text-xs font-semibold text-slate-600 rounded-[4px] hover:bg-slate-50 cursor-pointer">
          <span class="text-[#3E6AE1] font-mono mr-1">[${idx + 1}]</span> ${escapeHtml(p.name)}
        </button>
      `;
    }).join('');
    
    // Add event listeners programmatically to bypass HTML escaping/quoting issues
    const pills = pillsContainer.querySelectorAll('.speaker-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        const name = decodeURIComponent(pill.getAttribute('data-speaker'));
        setActiveSpeakerAndCutOff(name);
      });
    });
    
    // Set active speaker if not set or if current active is no longer in participants
    const activeSpeakerInput = document.getElementById('select-live-speaker');
    const currentActive = activeSpeakerInput.value;
    const exists = participants.some(p => p.name === currentActive);
    if (!currentActive || !exists) {
      setActiveSpeaker(participants[0].name);
    } else {
      setActiveSpeaker(currentActive);
    }
  } else {
    pillsContainer.innerHTML = `<span class="text-xs text-slate-500 font-light">-- Tidak ada peserta rapat --</span>`;
    document.getElementById('select-live-speaker').value = '';
  }
};

window.setActiveSpeaker = function(speakerName) {
  const activeSpeakerInput = document.getElementById('select-live-speaker');
  if (activeSpeakerInput) activeSpeakerInput.value = speakerName;
  
  // Highlight active pill
  const pills = document.querySelectorAll('.speaker-pill');
  pills.forEach(p => {
    p.classList.remove('active', 'border-[#3E6AE1]/30', 'bg-blue-50/50', 'text-[#3E6AE1]');
    p.classList.add('border-slate-200', 'bg-white', 'text-slate-600');
    
    const pillSpeaker = decodeURIComponent(p.getAttribute('data-speaker') || '');
    if (pillSpeaker === speakerName) {
      p.classList.remove('border-slate-200', 'bg-white', 'text-slate-600');
      p.classList.add('active', 'border-[#3E6AE1]/30', 'bg-blue-50/50', 'text-[#3E6AE1]');
    }
  });

  // Update the live transcript container header and avatar if it exists in the DOM
  const liveContainer = document.getElementById('live-transcript-container');
  if (liveContainer) {
    const liveInitials = speakerName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'P';
    const liveSpeakerHeader = liveContainer.querySelector('.live-speaker-header-label');
    if (liveSpeakerHeader) {
      liveSpeakerHeader.innerHTML = `<span class="h-2 w-2 rounded-full bg-red-500 animate-ping"></span> ${speakerName} (Live)`;
    }
    const liveAvatar = liveContainer.querySelector('.flex-shrink-0');
    if (liveAvatar) {
      liveAvatar.textContent = liveInitials;
    }
  }
};

window.setActiveSpeakerAndCutOff = async function(speakerName) {
  const prevSpeaker = document.getElementById('select-live-speaker').value;
  
  // Update speaker pill status first
  setActiveSpeaker(speakerName);

  const textToSave = liveTranscriptAccumulated.trim();

  // If changing speaker and there's text to save, save it under the previous speaker
  if (textToSave && prevSpeaker && prevSpeaker !== speakerName) {
    // Save to offset and reset
    liveTranscriptOffset += (liveTranscriptOffset ? " " : "") + textToSave;
    liveTranscriptAccumulated = '';
    liveTranscriptCommitted = '';
    liveTranscriptActive = '';
    
    const liveTextEl = document.getElementById('live-transcript-text');
    if (liveTextEl) liveTextEl.textContent = '';
    
    // Add block optimistically to transcripts list immediately
    addOptimisticTranscript(textToSave, prevSpeaker);
    
    await saveLiveTranscript(textToSave, prevSpeaker);
  }
};

// --- Profile Functions ---
async function loadUserProfile() {
  try {
    const res = await fetch('/api/profile');
    if (res.ok) {
      const user = await res.json();
      if (userDisplayName) {
        userDisplayName.textContent = user.fullname || user.username;
        userDisplayName.classList.remove('hidden');
      }
      if (inputProfileUsername) inputProfileUsername.value = user.username;
      if (inputProfileFullname) inputProfileFullname.value = user.fullname || '';
      if (inputProfileEmail) inputProfileEmail.value = user.email || '';
      if (inputProfileOldPass) inputProfileOldPass.value = '';
      if (inputProfileNewPass) inputProfileNewPass.value = '';
      if (inputProfileConfirmPass) inputProfileConfirmPass.value = '';
    }
  } catch (err) {
    console.error('Error loading user profile:', err);
  }
}

if (btnProfile) {
  btnProfile.addEventListener('click', () => {
    loadUserProfile();
    modalProfile.classList.remove('hidden');
  });
}

if (btnCloseProfileModal) {
  btnCloseProfileModal.addEventListener('click', () => {
    modalProfile.classList.add('hidden');
  });
}

const btnDiskCleanup = document.getElementById('btn-disk-cleanup');
if (btnDiskCleanup) {
  btnDiskCleanup.addEventListener('click', async () => {
    if (!confirm('Apakah Anda yakin ingin membersihkan file sampah audio yang berusia lebih dari 10 menit?')) {
      return;
    }
    btnDiskCleanup.disabled = true;
    const originalText = btnDiskCleanup.textContent;
    btnDiskCleanup.textContent = 'Membersihkan...';
    try {
      const res = await fetch('/api/admin/cleanup', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Pembersihan berhasil dilakukan.');
      } else {
        showToast(data.error || 'Gagal melakukan pembersihan disk.', 'error');
      }
    } catch (err) {
      showToast('Terjadi kesalahan saat memproses pembersihan disk.', 'error');
    } finally {
      btnDiskCleanup.disabled = false;
      btnDiskCleanup.textContent = originalText;
    }
  });
}

if (formProfile) {
  formProfile.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fullname = inputProfileFullname.value.trim();
    const email = inputProfileEmail.value.trim();
    const currentPassword = inputProfileOldPass.value;
    const newPassword = inputProfileNewPass.value;
    const confirmPassword = inputProfileConfirmPass.value;
    
    if (newPassword || confirmPassword) {
      if (!currentPassword) {
        showToast('Kata sandi saat ini harus diisi jika ingin mengganti kata sandi.', 'error');
        inputProfileOldPass.focus();
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('Konfirmasi kata sandi baru tidak cocok.', 'error');
        inputProfileConfirmPass.focus();
        return;
      }
      if (newPassword.length < 6) {
        showToast('Kata sandi baru minimal 6 karakter.', 'error');
        inputProfileNewPass.focus();
        return;
      }
    }
    
    const submitBtn = formProfile.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';
    
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullname,
          email,
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined
        })
      });
      
      const data = await res.json();
      if (res.ok) {
        showToast('Profil Anda berhasil diperbarui!');
        modalProfile.classList.add('hidden');
        loadUserProfile();
      } else {
        showToast(data.error || 'Gagal memperbarui profil.', 'error');
      }
    } catch (err) {
      showToast('Terjadi kesalahan saat menyimpan perubahan profil.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// --- Initial Launch ---
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/login.html';
    } else {
      switchView('dashboard');
      loadUserProfile();
    }
  } catch (err) {
    window.location.href = '/login.html';
  }
}

checkAuth();
