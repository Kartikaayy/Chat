/**
 * PULSE CHAT  —  chat.js
 * Place at: src/main/resources/static/js/chat.js
 */

/* ════════════════════════════════════════════
   MOBILE VIEWPORT FIX
   When the keyboard opens, the visual viewport shrinks.
   We pin the chat screen height so the footer stays visible.
════════════════════════════════════════════ */
function fixViewportHeight() {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const cs = document.getElementById('chatScreen');
    if (cs && cs.style.display !== 'none') {
        cs.style.height = vh + 'px';
    }
}

if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fixViewportHeight);
    window.visualViewport.addEventListener('scroll', fixViewportHeight);
} else {
    window.addEventListener('resize', fixViewportHeight);
}


/* ════════════════════════════════════════════
   STATE
════════════════════════════════════════════ */
var stompClient = null;
var currentRoom = null;
var currentUser = null;
var typingTimer = null;
var amTyping    = false;
var typingUsers = new Set();


/* ════════════════════════════════════════════
   SOUNDS  (Web Audio API — no files needed)
════════════════════════════════════════════ */
let _audioCtx;

function getAudioCtx() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioCtx;
}

function playTone(freq, type, duration, volume, delay = 0) {
    try {
        const ctx  = getAudioCtx();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type           = type;
        osc.frequency.value = freq;
        const startTime = ctx.currentTime + delay;
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
    } catch (e) { /* silent fail */ }
}

function soundJoin()    { playTone(880, 'sine', 0.25, 0.18); playTone(1100, 'sine', 0.2, 0.12, 0.12); }
function soundLeave()   { playTone(660, 'sine', 0.25, 0.14); playTone(440,  'sine', 0.25, 0.09, 0.12); }
function soundMessage() { playTone(1200, 'sine', 0.12, 0.09); }

// Unlock AudioContext on first user interaction (required on mobile)
document.addEventListener('click', () => {
    try { getAudioCtx().resume(); } catch (e) {}
}, { once: true });


/* ════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════ */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return `hsl(${Math.abs(hash) % 360}, 65%, 58%)`;
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function shakeInput(id) {
    const el = document.getElementById(id);
    el.style.borderColor = '#ff6b6b';
    el.style.boxShadow   = '0 0 0 3px rgba(255, 107, 107, 0.2)';
    setTimeout(() => {
        el.style.borderColor = '';
        el.style.boxShadow   = '';
    }, 1000);
}


/* ════════════════════════════════════════════
   JOIN SCREEN
════════════════════════════════════════════ */
document.getElementById('createRoomBtn').onclick = () => {
    const code = generateRoomCode();
    document.getElementById('generatedCode').textContent = code;
    document.getElementById('createdRoomBox').style.display = 'block';
    document.getElementById('roomInput').value = code;

    document.getElementById('codeBox').onclick = () => {
        navigator.clipboard.writeText(code).catch(() => {});
        document.getElementById('generatedCode').textContent = 'COPIED!';
        document.querySelector('.code-hint').textContent = '✓ Copied!';
        setTimeout(() => {
            document.getElementById('generatedCode').textContent = code;
            document.querySelector('.code-hint').textContent = 'Tap to copy · Share with friends';
        }, 1800);
    };
};

document.getElementById('enterCreatedBtn').onclick = enterChat;
document.getElementById('joinRoomBtn').onclick      = enterChat;

function enterChat() {
    const name = document.getElementById('nameInput').value.trim();
    const room = document.getElementById('roomInput').value.trim().toUpperCase();

    if (!name) { shakeInput('nameInput'); return; }
    if (!room) { shakeInput('roomInput'); return; }

    currentUser = name;
    currentRoom = room;

    document.getElementById('joinScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';
    fixViewportHeight();

    document.getElementById('roomPill').textContent = room;
    document.getElementById('headerMeta').textContent = `You: ${name}`;

    document.getElementById('roomPill').onclick = () => {
        navigator.clipboard.writeText(room).catch(() => {});
        const pill = document.getElementById('roomPill');
        pill.textContent = 'COPIED!';
        setTimeout(() => { pill.textContent = room; }, 1500);
    };

    connectToRoom(room, name);
}


/* ════════════════════════════════════════════
   MEMBERS DRAWER  (mobile slide-in)
════════════════════════════════════════════ */
function openDrawer() {
    document.getElementById('membersDrawer').classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('show');
}

function closeDrawer() {
    document.getElementById('membersDrawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('show');
}

document.getElementById('membersToggle').onclick  = openDrawer;
document.getElementById('drawerClose').onclick    = closeDrawer;
document.getElementById('drawerBackdrop').onclick = closeDrawer;


/* ════════════════════════════════════════════
   WEBSOCKET  /  STOMP
════════════════════════════════════════════ */
function connectToRoom(room, name) {
    const socket = new SockJS('/chat');
    stompClient  = Stomp.over(socket);
    stompClient.debug = null; // suppress console noise

    stompClient.connect({}, function () {
        document.getElementById('sendBtn').disabled = false;

        // Subscribe: chat messages
        stompClient.subscribe('/topic/messages/' + room, function (frame) {
            handleIncomingMessage(JSON.parse(frame.body));
        });

        // Subscribe: typing events
        stompClient.subscribe('/topic/typing/' + room, function (frame) {
            handleTypingEvent(JSON.parse(frame.body));
        });

        // Subscribe: member list updates
        stompClient.subscribe('/topic/members/' + room, function (frame) {
            updateMemberList(JSON.parse(frame.body).message);
        });

        // Announce join
        stompClient.send('/app/join/' + room, {}, JSON.stringify({
            sender: name,
            message: name + ' joined ✦',
            room: room,
            type: 'JOIN'
        }));
    });
}

function handleIncomingMessage(data) {
    if (data.type === 'JOIN') {
        showSystemMessage(data.sender + ' joined the room ✦');
        if (data.sender !== currentUser) soundJoin();

    } else if (data.type === 'LEAVE') {
        showSystemMessage(data.sender + ' left the room');
        if (data.sender !== currentUser) soundLeave();

    } else {
        renderMessage(data);
        if (data.sender !== currentUser) soundMessage();
    }
}


/* ════════════════════════════════════════════
   LEAVE ROOM
════════════════════════════════════════════ */
document.getElementById('leaveBtn').onclick = () => {
    if (stompClient) {
        stompClient.send('/app/leave/' + currentRoom, {}, JSON.stringify({
            sender:  currentUser,
            message: currentUser + ' left',
            room:    currentRoom,
            type:    'LEAVE'
        }));
        setTimeout(() => stompClient.disconnect(), 200);
    }

    // Reset UI
    document.getElementById('chatScreen').style.display  = 'none';
    document.getElementById('chat').innerHTML =
        `<div class="empty-state" id="emptyState">
            <div class="icon">💬</div>
            <p>Be the first to say something…</p>
         </div>`;
    document.getElementById('membersList').innerHTML   = '';
    document.getElementById('memberCount').textContent = '0';
    document.getElementById('membersBadge').textContent = '0';
    document.getElementById('typingBar').innerHTML     = '';
    document.getElementById('sendBtn').disabled        = true;

    typingUsers.clear();
    amTyping = false;
    closeDrawer();

    document.getElementById('joinScreen').style.display = 'block';
};


/* ════════════════════════════════════════════
   SEND MESSAGE
════════════════════════════════════════════ */
function sendMessage() {
    const content = document.getElementById('messageInput').value.trim();
    if (!content || !stompClient) return;

    stompClient.send('/app/sendMessage/' + currentRoom, {}, JSON.stringify({
        sender:  currentUser,
        message: content,
        room:    currentRoom,
        type:    'CHAT'
    }));

    document.getElementById('messageInput').value = '';
    stopTyping();
}

document.getElementById('sendBtn').onclick = sendMessage;

document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});


/* ════════════════════════════════════════════
   TYPING INDICATOR
════════════════════════════════════════════ */
document.getElementById('messageInput').addEventListener('input', () => {
    if (!stompClient) return;

    if (!amTyping) {
        amTyping = true;
        stompClient.send('/app/typing/' + currentRoom, {}, JSON.stringify({
            sender:  currentUser,
            message: 'typing',
            room:    currentRoom,
            type:    'TYPING'
        }));
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 2000);
});

function stopTyping() {
    if (!amTyping || !stompClient) return;
    amTyping = false;
    stompClient.send('/app/typing/' + currentRoom, {}, JSON.stringify({
        sender:  currentUser,
        message: 'stop',
        room:    currentRoom,
        type:    'STOP_TYPING'
    }));
}

function handleTypingEvent(data) {
    if (data.sender === currentUser) return;

    if (data.type === 'TYPING' || data.message === 'typing') {
        typingUsers.add(data.sender);
    } else {
        typingUsers.delete(data.sender);
    }
    renderTypingBar();
}

function renderTypingBar() {
    const bar = document.getElementById('typingBar');

    if (typingUsers.size === 0) {
        bar.innerHTML = '';
        return;
    }

    const names = [...typingUsers];
    let label;
    if      (names.length === 1) label = `${names[0]} is typing`;
    else if (names.length === 2) label = `${names[0]} and ${names[1]} are typing`;
    else                         label = `${names[0]} and ${names.length - 1} others are typing`;

    bar.innerHTML = `
        <div class="typing-dots"><i></i><i></i><i></i></div>
        <span>${label}</span>`;
}


/* ════════════════════════════════════════════
   MEMBER LIST
════════════════════════════════════════════ */
function updateMemberList(csvNames) {
    const names = (csvNames || '').split(',').filter(Boolean);
    const list  = document.getElementById('membersList');
    list.innerHTML = '';

    document.getElementById('memberCount').textContent  = names.length;
    document.getElementById('membersBadge').textContent = names.length;

    names.forEach((name, index) => {
        const item = document.createElement('div');
        item.className = 'member-item';
        item.style.animationDelay = (index * 0.05) + 's';

        const avatar = document.createElement('div');
        avatar.className = 'member-avatar-sm';
        avatar.style.background = getAvatarColor(name);
        avatar.textContent = name.charAt(0).toUpperCase();

        const nameEl = document.createElement('div');
        nameEl.className = 'member-name' + (name === currentUser ? ' is-you' : '');
        nameEl.textContent = name === currentUser ? name + ' (you)' : name;

        const dot = document.createElement('div');
        dot.className = 'member-online';

        item.append(avatar, nameEl, dot);
        list.appendChild(item);
    });
}


/* ════════════════════════════════════════════
   EMOJI PANEL
════════════════════════════════════════════ */
const EMOJI_LIST = [
    '😀','😂','🥰','😎','🤔','😅','🔥','✨',
    '👍','❤️','🎉','💯','😭','🤣','👀','💀',
    '🙏','😤','🥳','💪','🫡','🫶','🤝','💥','🌟'
];

const emojiPanel = document.getElementById('emojiPanel');

EMOJI_LIST.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.className   = 'ep-btn';
    btn.textContent = emoji;
    btn.onclick = () => {
        document.getElementById('messageInput').value += emoji;
        document.getElementById('messageInput').focus();
        emojiPanel.classList.remove('show');
    };
    emojiPanel.appendChild(btn);
});

document.getElementById('emojiToggle').onclick = (e) => {
    e.stopPropagation();
    emojiPanel.classList.toggle('show');
};

document.addEventListener('click', () => emojiPanel.classList.remove('show'));
emojiPanel.addEventListener('click', (e) => e.stopPropagation());


/* ════════════════════════════════════════════
   RENDER MESSAGES
════════════════════════════════════════════ */
function showSystemMessage(text) {
    const chat = document.getElementById('chat');
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.remove();

    const el = document.createElement('div');
    el.className   = 'system-msg';
    el.textContent = text;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
}

function renderMessage(msg) {
    const chat = document.getElementById('chat');
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.remove();

    const isSelf = msg.sender === currentUser;

    // Row wrapper
    const row = document.createElement('div');
    row.className = 'msg-row ' + (isSelf ? 'self' : 'other');

    // Avatar
    const avatar = document.createElement('div');
    avatar.className       = 'msg-avatar';
    avatar.style.background = getAvatarColor(msg.sender);
    avatar.textContent      = msg.sender.charAt(0).toUpperCase();

    // Content column
    const content = document.createElement('div');
    content.className = 'msg-content';

    // Sender name (only for others)
    if (!isSelf) {
        const nameEl = document.createElement('div');
        nameEl.className   = 'msg-name';
        nameEl.textContent = msg.sender;
        content.appendChild(nameEl);
    }

    // Bubble
    const bubble = document.createElement('div');
    bubble.className   = 'msg-bubble';
    bubble.textContent = msg.message;
    content.appendChild(bubble);

    // Timestamp
    const time = document.createElement('div');
    time.className   = 'msg-time';
    time.textContent = formatTime(new Date());
    content.appendChild(time);

    row.append(avatar, content);
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
}