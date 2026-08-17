const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow all in dev
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8, // 100 MB max audio size
});

const ANIMALS = [
  { id: 'dog', name: 'Dog', emoji: '🐶' },
  { id: 'cat', name: 'Cat', emoji: '🐱' },
  { id: 'cow', name: 'Cow', emoji: '🐮' },
  { id: 'pig', name: 'Pig', emoji: '🐷' },
  { id: 'sheep', name: 'Sheep', emoji: '🐑' },
  { id: 'chicken', name: 'Chicken', emoji: '🐔' },
  { id: 'duck', name: 'Duck', emoji: '🦆' },
  { id: 'frog', name: 'Frog', emoji: '🐸' },
  { id: 'owl', name: 'Owl', emoji: '🦉' },
  { id: 'monkey', name: 'Monkey', emoji: '🐵' },
  { id: 'lion', name: 'Lion', emoji: '🦁' },
  { id: 'horse', name: 'Horse', emoji: '🐴' },
  { id: 'wolf', name: 'Wolf', emoji: '🐺' },
  { id: 'mouse', name: 'Mouse', emoji: '🐭' },
  { id: 'snake', name: 'Snake', emoji: '🐍' },
  { id: 'elephant', name: 'Elephant', emoji: '🐘' },
  { id: 'bee', name: 'Bee', emoji: '🐝' },
  { id: 'dolphin', name: 'Dolphin', emoji: '🐬' }
];

// Room State
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for(let i=0; i<4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function getOptions(correctAnimal, deck) {
  const sourceDeck = (deck && deck.length > 0) ? deck : ANIMALS;
  const options = [correctAnimal];
  const others = sourceDeck.filter(a => a.id !== correctAnimal.id).sort(() => 0.5 - Math.random());
  options.push(...others.slice(0, 3));
  return options.sort(() => 0.5 - Math.random());
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', (data, callback) => {
    const roomId = generateRoomCode();
    const room = {
      roomId,
      players: [{ id: socket.id, name: data.playerName, score: 0 }],
      phase: 'LOBBY', // LOBBY, RECORDING, GUESSING, REVEAL, GAME_OVER
      currentTurnIndex: 0,
      totalTurnsTaken: 0,
      maxTurns: 0,
      currentAnimal: null,
      currentAudio: null,
      options: [],
      guesses: [],
      customDeck: []
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    callback({ success: true, roomId });
    io.to(roomId).emit('room_update', room);
  });

  socket.on('join_room', (data, callback) => {
    const { roomId, playerName } = data;
    const room = rooms.get(roomId);
    if (!room) {
      return callback({ success: false, error: 'Room not found' });
    }
    if (room.phase !== 'LOBBY') {
      return callback({ success: false, error: 'Game already in progress' });
    }
    room.players.push({ id: socket.id, name: playerName, score: 0 });
    socket.join(roomId);
    callback({ success: true, roomId });
    io.to(roomId).emit('room_update', room);
  });

  socket.on('start_game', (data) => {
    const roomId = typeof data === 'string' ? data : data.roomId;
    const rounds = data.rounds || 2;
    const customDeck = data.customDeck || [];
    
    const room = rooms.get(roomId);
    if (room && room.players.length > 1) {
      if (customDeck.length >= 4) {
        room.customDeck = customDeck;
      } else {
        room.customDeck = []; // fallback to default
      }
      room.players.forEach(p => p.score = 0); // Reset scores
      room.totalTurnsTaken = 0;
      room.currentTurnIndex = 0;
      room.maxTurns = room.players.length * rounds;
      startTurn(room);
    }
  });

  socket.on('audio_recorded', ({ roomId, audioData }) => {
    const room = rooms.get(roomId);
    if (room && room.players[room.currentTurnIndex].id === socket.id) {
      room.currentAudio = audioData;
      room.phase = 'GUESSING';
      io.to(roomId).emit('room_update', room);
    }
  });

  socket.on('submit_guess', ({ roomId, animalId }) => {
    const room = rooms.get(roomId);
    if (room && room.phase === 'GUESSING') {
      const existingGuess = room.guesses.find(g => g.playerId === socket.id);
      if (!existingGuess) {
        room.guesses.push({ playerId: socket.id, animalId });
        io.to(roomId).emit('room_update', room);
        
        // If everyone except the actor guessed
        if (room.guesses.length >= room.players.length - 1) {
          revealPhase(room);
        }
      }
    }
  });

  socket.on('next_turn', (roomId) => {
    const room = rooms.get(roomId);
    if (room && room.phase === 'REVEAL') {
      room.totalTurnsTaken++;
      if (room.totalTurnsTaken >= room.maxTurns) {
        room.phase = 'GAME_OVER';
        io.to(roomId).emit('room_update', room);
      } else {
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        startTurn(room);
      }
    }
  });
  
  socket.on('return_to_lobby', (roomId) => {
    const room = rooms.get(roomId);
    if (room && room.phase === 'GAME_OVER') {
      room.phase = 'LOBBY';
      io.to(roomId).emit('room_update', room);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    for (const [roomId, room] of rooms.entries()) {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit('room_update', room);
        }
        break;
      }
    }
  });
});

function startTurn(room) {
  room.phase = 'RECORDING';
  const sourceDeck = (room.customDeck && room.customDeck.length > 0) ? room.customDeck : ANIMALS;
  room.currentAnimal = sourceDeck[Math.floor(Math.random() * sourceDeck.length)];
  room.currentAudio = null;
  room.options = getOptions(room.currentAnimal, sourceDeck);
  room.guesses = [];
  io.to(room.roomId).emit('room_update', room);
}

function revealPhase(room) {
  room.phase = 'REVEAL';
  // Calculate scores
  room.guesses.forEach(g => {
    if (g.animalId === room.currentAnimal.id) {
      const player = room.players.find(p => p.id === g.playerId);
      if (player) player.score += 10; // 10 points for correct guess
    }
  });
  // Also give points to the actor if someone got it right
  const correctGuesses = room.guesses.filter(g => g.animalId === room.currentAnimal.id).length;
  if (correctGuesses > 0) {
    room.players[room.currentTurnIndex].score += 5; // 5 points if at least one guessed it
  }
  
  io.to(room.roomId).emit('room_update', room);
}

// Serve static files from the React frontend app
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Anything that doesn't match the API, send back index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
