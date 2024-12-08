class Metronome {
    constructor() {
        this.tempo = 120;
        this.isPlaying = false;
        this.audioContext = null; // Don't create context immediately
        this.nextNoteTime = 0;
        this.timerId = null;
        this.currentBeat = 0;
        this.beatsPerBar = 4;
        this.subdivision = 1;
        this.accentFirst = true;
        this.onBeat = null; // Callback for beat visualization
        this.syncOffset = 0;  // Time difference between host and client
    }

    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }
    }

    scheduleNote(time, isAccent, isSubdivision) {
        if (!this.audioContext) return;
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        if (isAccent) {
            osc.frequency.value = 880; // High pitch for accent
            gainNode.gain.value = 0.8;
        } else if (isSubdivision) {
            osc.frequency.value = 330; // Lower pitch for subdivisions
            gainNode.gain.value = 0.3;
        } else {
            osc.frequency.value = 440; // Normal pitch for main beats
            gainNode.gain.value = 0.5;
        }
        
        osc.start(time);
        osc.stop(time + 0.05);
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
        if (this.isPlaying) return;
        if (!this.audioContext) this.initAudio();
        this.isPlaying = true;
        this.nextNoteTime = this.audioContext.currentTime;
        this.scheduler();
    }

    stop() {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        clearTimeout(this.timerId);
    }

    setTempo(newTempo) {
        this.tempo = newTempo;
    }
    
    reset() {
        this.stop();
        this.currentBeat = 0;
        this.nextNoteTime = 0;
        if (this.onBeat) {
            this.onBeat(0);
        }
        // Update play button state
        document.getElementById('play-pause').textContent = 'Play';
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
            isPlaying: this.isPlaying
        };
    }

    setSyncOffset(offset) {
        this.syncOffset = offset;
        this.nextNoteTime = this.audioContext?.currentTime + offset;
    }

    getCurrentTime() {
        return this.audioContext?.currentTime ?? 0;
    }
}

const metronome = new Metronome();
let connections = [];
let isRoomOwner = false;
let clientConnection = null; // Add at the top with other variables
let disconnectTimeout = null;

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const roomCode = generateRoomCode();
const peer = new Peer(roomCode);

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

peer.on('open', (id) => {
    document.getElementById('room-display').textContent = id;
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
    isRoomOwner = true;
    metronome.initAudio();
    showPanel('host-panel');
    createBeatIndicators('beat-indicators', metronome.beatsPerBar);
});

document.getElementById('join-room').addEventListener('click', () => {
    const roomCode = document.getElementById('room-code').value;
    if (!roomCode || roomCode.length !== 6 || isNaN(roomCode)) {
        alert('Please enter a valid 6-digit room code');
        return;
    }
    
    metronome.initAudio();
    
    if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
    }
    
    const conn = peer.connect(roomCode);
    clientConnection = conn; // Store connection reference
    
    conn.on('open', () => {
        showPanel('client-panel');
        updateConnectionStatus('connected');
        createBeatIndicators('client-beat-indicators', 4); // Default to 4/4
        
        conn.on('data', (data) => {
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
            } else if (data.type === 'reset') {
                metronome.reset();
                document.getElementById('play-pause').textContent = 'Play';
            } else if (data.type === 'syncRequest') {
                // Host receives sync request
                conn.send({
                    type: 'syncResponse',
                    hostTime: metronome.getCurrentTime(),
                    clientTime: data.clientTime,
                    metronomeState: metronome.getState()
                });
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
            }
        });
        startPeriodicSync();
    });

    conn.on('close', () => {
        metronome.stop();
        updateConnectionStatus('disconnected');
        disconnectTimeout = setTimeout(() => {
            showPanel('initial-panel');
            clientConnection = null;
        }, 2000);
    });
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
    document.getElementById('play-pause').textContent = 'Play';
    document.getElementById('sync-status').textContent = 'Synced';
    document.getElementById('room-code').value = '';
    showPanel('initial-panel');
}

// Replace the single leave-room event listener with these two
document.getElementById('delete-room').addEventListener('click', leaveRoom);
document.getElementById('leave-room-client').addEventListener('click', leaveRoom);

peer.on('connection', (conn) => {
    // Clean up any existing connections with the same peer
    const existingConn = connections.find(c => c.peer === conn.peer);
    if (existingConn) {
        connections = connections.filter(c => c !== existingConn);
        existingConn.close();
    }
    
    connections.push(conn);
    document.getElementById('user-count').textContent = connections.length;
    
    // Send current state to new connection
    conn.send({ type: 'tempo', value: metronome.tempo });
    conn.send({ type: 'playState', value: metronome.isPlaying });
    conn.send({ type: 'timeSignature', value: metronome.beatsPerBar });
    conn.send({ type: 'subdivision', value: metronome.subdivision });
    conn.send({ type: 'accent', value: metronome.accentFirst });
    
    conn.on('close', () => {
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
});

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
    if (metronome.isPlaying) {
        metronome.stop();
        e.target.textContent = 'Play';
    } else {
        metronome.start();
        e.target.textContent = 'Pause';
    }
    
    connections.forEach(conn => {
        conn.send({ type: 'playState', value: metronome.isPlaying });
    });
});

// Add event listeners for new controls
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

// Add after metronome initialization
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

// Replace the minify-controls event listener with this one
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

document.getElementById('reset-metronome').addEventListener('click', () => {
    if (!isRoomOwner) return;
    metronome.reset();
    connections.forEach(conn => {
        conn.send({ type: 'reset' });
    });
});

document.getElementById('reset-metronome-client').addEventListener('click', () => {
    if (clientConnection) {
        metronome.reset();
    }
});

// Add sync functionality
function syncWithHost() {
    if (!isRoomOwner && clientConnection) {
        clientConnection.send({ 
            type: 'syncRequest', 
            clientTime: metronome.getCurrentTime(),
            isPlaying: metronome.isPlaying
        });
    }
}

// Add periodic sync
function startPeriodicSync() {
    if (!isRoomOwner && clientConnection) {
        const sync = () => {
            updateConnectionStatus('syncing');
            syncWithHost();
            setTimeout(() => {
                if (metronome.isPlaying) {
                    updateConnectionStatus('playing');
                } else {
                    updateConnectionStatus('connected');
                }
            }, 500);
        };
        
        sync(); // Initial sync
        setInterval(sync, 5000);
    }
}