class Metronome {
    constructor() {
        this.tempo = 120;
        this.nextNoteTime = 0;
        this.timerId = null;
        this.currentBeat = 0;
        this.beatsPerBar = 4;
        this.subdivision = 1;
        this.accentFirst = true;
        this.onBeat = null;
        this.syncOffset = 0;
        this.soundSets = {
            quartz: {
                high: new Howl({
                    src: ['assets/sounds/Perc_MetronomeQuartz_hi.ogg'],
                    preload: true
                }),
                low: new Howl({
                    src: ['assets/sounds/Perc_MetronomeQuartz_lo.ogg'],
                    preload: true
                })
            },
            musicStand: {
                high: new Howl({
                    src: ['assets/sounds/Perc_MusicStand_hi.ogg'],
                    preload: true
                }),
                low: new Howl({
                    src: ['assets/sounds/Perc_MusicStand_lo.ogg'],
                    preload: true
                })
            }
        };
        this.sounds = this.soundSets.quartz; // Default sound set
        this.currentSoundSet = 'quartz';
        this.audioContext = { currentTime: performance.now() / 1000 }; // Mock for timing
    }

    scheduleNote(time, isAccent, isSubdivision) {
        const now = this.getCurrentTime();
        const delay = Math.max(0, (time - now) * 1000); // Convert to milliseconds
        
        setTimeout(() => {
            if (isAccent) {
                this.sounds.high.play();
            } else {
                this.sounds.low.volume(isSubdivision ? 0.6 : 1);
                this.sounds.low.play();
            }
        }, delay);
    }

    nextNote() {
        const secondsPerBeat = 60.0 / this.tempo;
        const secondsPerSubdivision = secondsPerBeat / this.subdivision;
        this.nextNoteTime += secondsPerSubdivision;
        
        this.currentBeat++;
        if (this.currentBeat >= this.beatsPerBar * this.subdivision) {
            this.currentBeat = 0;
        }
    }

    scheduler() {
        const currentTime = this.getCurrentTime() + this.syncOffset;
        while (this.nextNoteTime < currentTime + 0.1) {
            const isFirstBeat = this.currentBeat === 0;
            const isMainBeat = this.currentBeat % this.subdivision === 0;
            
            this.scheduleNote(
                this.nextNoteTime,
                this.accentFirst && isFirstBeat,
                !isMainBeat // True for subdivision beats
            );
            
            if (this.onBeat) {
                this.onBeat(this.currentBeat);
            }
            
            this.nextNote();
        }
        this.timerId = setTimeout(() => this.scheduler(), 25);
    }

    setTimeSignature(beats) {
        this.beatsPerBar = beats;
        this.currentBeat = 0;
    }

    setSubdivision(value) {
        this.subdivision = parseInt(value);
        this.currentBeat = 0;
    }

    setAccent(value) {
        this.accentFirst = value;
    }

    start() {
        if (this.timerId) return;
        this.currentBeat = 0;  // Reset beat count before starting
        this.nextNoteTime = this.getCurrentTime();  // Use getCurrentTime instead of audioContext
        if (this.onBeat) {
            this.onBeat(0);  // Reset visualization
        }
        this.scheduler();
    }

    stop() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
            this.currentBeat = 0;  // Reset beat count when stopping
            if (this.onBeat) {
                this.onBeat(0);    // Update visualization
            }
        }
    }

    setTempo(newTempo) {
        this.tempo = newTempo;
    }

    setSyncOffset(offset, hostNextNoteTime) {
        this.syncOffset = offset;
        if (this.isPlaying && hostNextNoteTime) {
            // Adjust nextNoteTime based on host's timing
            this.nextNoteTime = hostNextNoteTime + offset;
            // Reset currentBeat to align with host
            this.currentBeat = Math.floor((this.nextNoteTime - this.audioContext.currentTime) 
                                        * (this.tempo / 60) * this.subdivision) % (this.beatsPerBar * this.subdivision);
        }
    }

    getState() {
        return {
            nextNoteTime: this.nextNoteTime,
            currentBeat: this.currentBeat,
            tempo: this.tempo,
            isPlaying: !!this.timerId, // Convert to boolean
            soundSet: this.currentSoundSet // Add sound set to state
        };
    }

    setSyncOffset(offset) {
        this.syncOffset = offset;
        this.nextNoteTime = this.audioContext?.currentTime + offset;
    }

    getCurrentTime() {
        return performance.now() / 1000;
    }

    setSound(soundSet) {
        if (this.soundSets[soundSet]) {
            this.sounds = this.soundSets[soundSet];
            this.currentSoundSet = soundSet;
        }
    }
}

const metronome = new Metronome();
let connections = [];
let isRoomOwner = false;
let clientConnection = null; 
let disconnectTimeout = null;
let connectionTimeout = null; // Add timeout for connection attempts
let connectionAttempts = 0;   // Track connection attempts
const MAX_CONNECTION_ATTEMPTS = 3;

// Check if browser supports required WebRTC features
function checkWebRTCSupport() {
    return !!(navigator.mediaDevices && 
              window.RTCPeerConnection && 
              window.RTCSessionDescription);
}

// Check if we're in a secure context (HTTPS or localhost)
function isSecureContext() {
    return window.isSecureContext || 
           location.protocol === 'https:' || 
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
}

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const roomCode = generateRoomCode();
let peer = null;

// Initialize PeerJS with enhanced configuration for cross-platform and cross-network support
function initializePeer(id) {
    try {
        // Enhanced configuration with multiple STUN/TURN servers for better connectivity
        const peerOptions = {
            debug: 2,
            config: {
                iceServers: [
                    // Google's public STUN servers
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    // Twilio's STUN server
                    { urls: 'stun:global.stun.twilio.com:3478' },
                    // Public TURN servers (you may want to replace these with your own private TURN servers)
                    {
                        urls: 'turn:numb.viagenie.ca',
                        username: 'webrtc@live.com',
                        credential: 'muazkh'
                    },
                    {
                        urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
                        username: 'webrtc',
                        credential: 'webrtc'
                    }
                ],
                // Force ICE trickling for better connection success
                iceCandidatePoolSize: 10
            }
        };
        
        // If running on a secure connection, use the default PeerJS server
        if (isSecureContext()) {
            peer = new Peer(id, peerOptions);
        } else {
            // Otherwise show an error - WebRTC requires secure context on iOS
            showError('This app requires HTTPS to work properly on iOS devices.');
            return false;
        }
        
        setupPeerEvents();
        return true;
    } catch (error) {
        console.error('PeerJS initialization error:', error);
        showError('Failed to initialize connection. Please try again.');
        return false;
    }
}

function setupPeerEvents() {
    peer.on('open', (id) => {
        console.log('PeerJS connection opened with ID:', id);
        document.getElementById('room-display').textContent = id;
    });
    
    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        let errorMessage = 'Connection error';
        
        // Provide more specific error messages based on error type
        if (err.type === 'peer-unavailable') {
            errorMessage = 'Room not found. Please check the code and try again.';
        } else if (err.type === 'network') {
            errorMessage = 'Network error. Please check your connection.';
        } else if (err.type === 'browser-incompatible') {
            errorMessage = 'Your browser may not fully support WebRTC.';
        } else if (err.type === 'disconnected') {
            errorMessage = 'Disconnected from signaling server. Trying to reconnect...';
            // Try to reconnect
            if (peer && !peer.destroyed) {
                peer.reconnect();
            }
        } else if (err.type === 'server-error') {
            errorMessage = 'PeerJS server error. Please try again later.';
        } else if (err.type === 'unavailable-id') {
            // Generate a new ID if our ID is taken
            const newId = generateRoomCode();
            peer.disconnect();
            peer.destroy();
            setTimeout(() => initializePeer(newId), 500);
            errorMessage = 'Room ID already in use. Getting a new room code...';
        }
        
        showError(errorMessage);
    });
    
    peer.on('connection', handleIncomingConnection);
    
    // Additional event handlers for better state tracking
    peer.on('disconnected', () => {
        console.log('PeerJS disconnected from server');
        if (peer && !peer.destroyed) {
            // Try to reconnect automatically
            setTimeout(() => peer.reconnect(), 3000);
        }
    });
    
    peer.on('close', () => {
        console.log('PeerJS connection closed');
        // Clean up if needed
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
        }
    });
}

function showError(message) {
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        
        // Hide after 5 seconds
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    } else {
        alert(message);
    }
}

function showPanel(panelId) {
    ['initial-panel', 'host-panel', 'client-panel'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    document.getElementById(panelId).style.display = 'block';
    
    // Reset minimized state when showing panels
    const controls = document.getElementById('room-controls');
    const btn = document.getElementById('minify-room');
    if (controls && btn) {
        controls.classList.remove('minimized');
        btn.classList.remove('minimized');
        controls.style.maxHeight = controls.scrollHeight + "px";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize when page loads
    if (checkWebRTCSupport()) {
        initializePeer(roomCode);
    } else {
        showError('Your browser doesn\'t support WebRTC, which is required for this app.');
    }
});

document.getElementById('copy-code').addEventListener('click', async () => {
    const code = document.getElementById('room-display').textContent;
    const btn = document.getElementById('copy-code');
    
    try {
        // Try modern clipboard API first
        await navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
    } catch (err) {
        // Fallback to older method
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            btn.textContent = 'Copied!';
        } catch (e) {
            btn.textContent = 'Failed!';
        }
        document.body.removeChild(textarea);
    }
    
    // Reset button text after delay
    setTimeout(() => btn.textContent = 'Copy', 2000);
});

document.getElementById('create-room').addEventListener('click', () => {
    if (!peer) {
        if (!initializePeer(roomCode)) {
            return;
        }
    }
    isRoomOwner = true;
    showPanel('host-panel');
    createBeatIndicators('beat-indicators', metronome.beatsPerBar);
});

document.getElementById('join-room').addEventListener('click', () => {
    const roomCodeInput = document.getElementById('room-code').value;
    if (!roomCodeInput || roomCodeInput.length !== 6 || isNaN(roomCodeInput)) {
        showError('Please enter a valid 6-digit room code');
        return;
    }
    
    if (!peer) {
        if (!initializePeer()) {
            return;
        }
    }
    
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }
    
    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
    }
    
    // Show connecting status
    updateConnectionStatus('connecting');
    showError('Connecting to room...');
    
    try {
        console.log('Attempting to connect to peer:', roomCodeInput);
        const conn = peer.connect(roomCodeInput, {
            reliable: true,
            serialization: 'json',
            // Debug data
            metadata: {
                clientId: peer.id,
                userAgent: navigator.userAgent,
                timestamp: Date.now()
            }
        });
        
        // Set connection timeout - if we don't get "open" event in 15 seconds, retry or fail
        connectionTimeout = setTimeout(() => {
            if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
                connectionAttempts++;
                showError(`Connection attempt ${connectionAttempts} timed out. Retrying...`);
                
                // Close any existing connection
                if (conn) conn.close();
                
                // Try again
                document.getElementById('join-room').click();
            } else {
                showError('Could not connect to the room after multiple attempts. Please check your network connection or try a different room code.');
                updateConnectionStatus('disconnected');
                connectionAttempts = 0;
            }
        }, 15000);
        
        clientConnection = conn;
        
        // Log connection events for debugging
        conn.on('open', () => {
            console.log('Connection opened with host:', conn.peer);
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
            connectionAttempts = 0;
            showPanel('client-panel');
            updateConnectionStatus('connected');
            createBeatIndicators('client-beat-indicators', 4);
            
            // Send a ping to confirm two-way communication
            conn.send({ type: 'ping', timestamp: Date.now() });
            
            conn.on('data', (data) => {
                console.log('Received data from host:', data.type);
                if (data.type === 'pong') {
                    console.log('Received pong - connection confirmed');
                } else {
                    handleClientData(data);
                }
            });
        });

        conn.on('close', () => {
            console.log('Connection closed with host');
            handleClientDisconnect();
        });
        
        conn.on('error', (err) => {
            console.error('Connection error:', err);
            handleClientDisconnect();
        });
        
        conn.on('iceStateChanged', (state) => {
            console.log('ICE state changed:', state);
        });
        
    } catch (error) {
        console.error('Failed to connect:', error);
        showError('Failed to join room. Please try again.');
        updateConnectionStatus('disconnected');
    }
});

function leaveRoom() {
    metronome.stop();
    if (isRoomOwner) {
        // Host cleanup
        connections.forEach(conn => conn.close());
        connections = [];
    } else if (clientConnection) {
        // Client cleanup
        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = null;
        }
        clientConnection.close();
        clientConnection = null;
    }
    isRoomOwner = false;
    document.getElementById('play-pause').textContent = 'Start';
    document.getElementById('sync-status').textContent = 'Synced';
    document.getElementById('room-code').value = '';
    showPanel('initial-panel');
}

// Replace the single leave-room event listener with these two
document.getElementById('delete-room').addEventListener('click', leaveRoom);
document.getElementById('leave-room-client').addEventListener('click', leaveRoom);

function handleIncomingConnection(conn) {
    console.log('Received connection from:', conn.peer, 'with metadata:', conn.metadata);
    
    // Clean up any existing connections with the same peer
    const existingConn = connections.find(c => c.peer === conn.peer);
    if (existingConn) {
        connections = connections.filter(c => c !== existingConn);
        existingConn.close();
    }
    
    connections.push(conn);
    document.getElementById('user-count').textContent = connections.length;
    
    // Set up error handler
    conn.on('error', (err) => {
        console.error('Connection error with client:', err);
        // Remove the connection on error
        connections = connections.filter(c => c !== conn);
        document.getElementById('user-count').textContent = connections.length;
    });
    
    // Handle ping/pong for connection validation
    conn.on('data', (data) => {
        if (data.type === 'ping') {
            // Respond to ping to confirm connection
            conn.send({ type: 'pong', timestamp: Date.now() });
        }
    });
    
    // Send current state to new connection
    conn.send({ type: 'tempo', value: metronome.tempo });
    conn.send({ type: 'playState', value: !!metronome.timerId });
    conn.send({ type: 'timeSignature', value: metronome.beatsPerBar });
    conn.send({ type: 'subdivision', value: metronome.subdivision });
    conn.send({ type: 'accent', value: metronome.accentFirst });
    conn.send({ type: 'sound', value: metronome.currentSoundSet });
    
    conn.on('close', () => {
        console.log('Client disconnected:', conn.peer);
        connections = connections.filter(c => c !== conn);
        document.getElementById('user-count').textContent = connections.length;
    });

    // Send initial sync data
    if (isRoomOwner) {
        conn.send({ 
            type: 'initialSync',
            hostTime: metronome.getCurrentTime(),
            nextNoteTime: metronome.nextNoteTime
        });
    }
}

function handleClientData(data) {
    // Fix the scope issue - clientConnection should be used instead of conn
    const conn = clientConnection;

    if (data.type === 'tempo') {
        metronome.setTempo(data.value);
        document.getElementById('current-tempo').textContent = data.value;
    } else if (data.type === 'timeSignature') {
        metronome.setTimeSignature(data.value);
        document.getElementById('time-signature').value = data.value;
        document.getElementById('current-time-sig').textContent = `${data.value}/4`;
        createBeatIndicators('client-beat-indicators', data.value);
    } else if (data.type === 'subdivision') {
        metronome.setSubdivision(data.value);
        document.getElementById('subdivision').value = data.value;
        const subdivText = {1: 'Quarter Notes', 2: 'Eighth Notes', 4: 'Sixteenth Notes'}[data.value];
        document.getElementById('current-subdivision').textContent = subdivText;
    } else if (data.type === 'accent') {
        metronome.setAccent(data.value);
        document.getElementById('accent-first').checked = data.value;
    } else if (data.type === 'playState') {
        if (data.value) {
            metronome.start();
            updateConnectionStatus('playing');
        } else {
            metronome.stop();
            updateConnectionStatus('connected');
        }
    } else if (data.type === 'syncRequest') {
        // Host receives sync request - make sure we use the right connection object
        if (conn) {
            conn.send({
                type: 'syncResponse',
                hostTime: metronome.getCurrentTime(),
                clientTime: data.clientTime,
                metronomeState: metronome.getState()
            });
        }
    } else if (data.type === 'syncResponse') {
        // Client receives sync response
        const now = metronome.getCurrentTime();
        const roundTripTime = now - data.clientTime;
        const estimatedOffset = data.hostTime + (roundTripTime / 2) - now;
        
        // Sync with host's metronome state
        const hostState = data.metronomeState;
        if (hostState.isPlaying) {
            // Calculate the projected nextNoteTime based on host's state
            const elapsedTime = now - (data.hostTime - roundTripTime/2);
            const projectedNextNoteTime = hostState.nextNoteTime + elapsedTime;
            metronome.setSyncOffset(estimatedOffset, projectedNextNoteTime);
        }
    } else if (data.type === 'sound') {
        metronome.setSound(data.value);
        const soundNames = {
            quartz: 'Quartz Click',
            musicStand: 'Music Stand'
        };
        document.getElementById('current-sound').textContent = soundNames[data.value];
    }
}

function handleClientDisconnect() {
    metronome.stop();
    updateConnectionStatus('disconnected');
    
    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
    }
    
    disconnectTimeout = setTimeout(() => {
        showPanel('initial-panel');
        clientConnection = null;
    }, 2000);
}

// Function to attempt periodic sync with the host
function startPeriodicSync() {
    if (!clientConnection || isRoomOwner) return;
    
    // Request time sync from host every 30 seconds
    setInterval(() => {
        if (clientConnection && clientConnection.open) {
            updateConnectionStatus('syncing');
            clientConnection.send({
                type: 'syncRequest',
                clientTime: metronome.getCurrentTime()
            });
            
            // Reset back to connected status if no sync response received
            setTimeout(() => {
                if (document.getElementById('sync-status').textContent === 'Syncing...') {
                    if (metronome.timerId) {
                        updateConnectionStatus('playing');
                    } else {
                        updateConnectionStatus('connected');
                    }
                }
            }, 2000);
        }
    }, 30000);
}

document.getElementById('tempo').addEventListener('input', (e) => {
    if (!isRoomOwner) return;
    const tempo = parseInt(e.target.value);
    metronome.setTempo(tempo);
    connections.forEach(conn => {
        conn.send({ type: 'tempo', value: tempo });
    });
});

document.getElementById('play-pause').addEventListener('click', (e) => {
    if (!isRoomOwner) return;
    if (metronome.timerId) {
        metronome.stop();
        e.target.textContent = 'Start';
    } else {
        metronome.start();
        e.target.textContent = 'Stop';
    }
    
    connections.forEach(conn => {
        conn.send({ type: 'playState', value: !!metronome.timerId });
    });
});

document.getElementById('time-signature').addEventListener('change', (e) => {
    if (!isRoomOwner) return;
    const beats = parseInt(e.target.value);
    metronome.setTimeSignature(beats);
    createBeatIndicators('beat-indicators', beats);
    connections.forEach(conn => {
        conn.send({ type: 'timeSignature', value: beats });
    });
});

document.getElementById('subdivision').addEventListener('change', (e) => {
    if (!isRoomOwner) return;
    const subdivision = parseInt(e.target.value);
    metronome.setSubdivision(subdivision);
    connections.forEach(conn => {
        conn.send({ type: 'subdivision', value: subdivision });
    });
});

document.getElementById('accent-first').addEventListener('change', (e) => {
    if (!isRoomOwner) return;
    metronome.setAccent(e.target.checked);
    connections.forEach(conn => {
        conn.send({ type: 'accent', value: e.target.checked });
    });
});

function createBeatIndicators(containerId, count) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const indicator = document.createElement('div');
        indicator.className = 'beat-indicator' + (i === 0 ? ' accent' : '');
        container.appendChild(indicator);
    }
}

metronome.onBeat = (beat) => {
    const indicators = document.querySelectorAll('.beat-indicator');
    indicators.forEach((ind, i) => {
        ind.classList.toggle('active', i === Math.floor(beat / metronome.subdivision));
    });
};

document.getElementById('minify-room').addEventListener('click', (e) => {
    const controls = document.getElementById('room-controls');
    const btn = e.target;
    
    // Set initial height if not set
    if (!controls.style.maxHeight) {
        controls.style.maxHeight = controls.scrollHeight + "px";
    }
    
    controls.classList.toggle('minimized');
    btn.classList.toggle('minimized');
    
    // Update max-height for animation
    if (!controls.classList.contains('minimized')) {
        controls.style.maxHeight = controls.scrollHeight + "px";
    }
});

function updateConnectionStatus(status) {
    const indicator = document.getElementById('connection-indicator');
    const statusText = document.getElementById('sync-status');
    
    indicator.className = 'connection-status';
    switch(status) {
        case 'connecting':
            indicator.classList.add('connecting');
            statusText.textContent = 'Connecting...';
            break;
        case 'connected':
            indicator.classList.add('connected');
            statusText.textContent = 'Connected';
            break;
        case 'playing':
            indicator.classList.add('connected', 'playing');
            statusText.textContent = 'Playing';
            break;
        case 'disconnected':
            indicator.classList.add('disconnected');
            statusText.textContent = 'Disconnected';
            break;
        case 'syncing':
            indicator.classList.add('connected');
            statusText.textContent = 'Syncing...';
            break;
        default:
            statusText.textContent = status;
    }
}

document.getElementById('sound-select').addEventListener('change', (e) => {
    if (!isRoomOwner) return;
    const soundSet = e.target.value;
    metronome.setSound(soundSet);
    connections.forEach(conn => {
        conn.send({ type: 'sound', value: soundSet });
    });
});