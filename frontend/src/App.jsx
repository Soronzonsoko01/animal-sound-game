import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './index.css';

// Use the current hostname but port 3001 in development (allows LAN testing)
const SOCKET_URL = (window.location.hostname === 'localhost' || window.location.port === '5173')
  ? `http://${window.location.hostname}:3001`
  : '/';

function App() {
  const [socket, setSocket] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('room_update', (updatedRoom) => {
      setRoom(updatedRoom);
      setError('');
    });

    return () => newSocket.close();
  }, []);

  const createRoom = () => {
    if (!playerName) return setError('Please enter your name!');
    socket.emit('create_room', { playerName }, (res) => {
      if (res.success) {
        setRoomId(res.roomId);
      }
    });
  };

  const joinRoom = () => {
    if (!playerName) return setError('Please enter your name!');
    if (!roomId) return setError('Please enter a room code!');
    socket.emit('join_room', { roomId: roomId.toUpperCase(), playerName }, (res) => {
      if (!res.success) {
        setError(res.error);
      }
    });
  };

  const startGame = () => {
    socket.emit('start_game', room.roomId);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          socket.emit('audio_recorded', { roomId: room.roomId, audioData: reader.result });
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      
      // Auto stop after 5 seconds
      setTimeout(() => {
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
          stopRecording();
        }
      }, 5000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Please allow microphone access to play!");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  };

  const submitGuess = (animalId) => {
    socket.emit('submit_guess', { roomId: room.roomId, animalId });
  };

  const nextTurn = () => {
    socket.emit('next_turn', room.roomId);
  };

  // Render Background Bubbles
  const renderBackground = () => (
    <ul className="bg-bubbles">
      <li></li><li></li><li></li><li></li><li></li>
      <li></li><li></li><li></li><li></li><li></li>
    </ul>
  );

  if (!room) {
    return (
      <>
        {renderBackground()}
        <div className="app-container">
          <h1>Animal <span>Sound</span> Guesser 🐱</h1>
          {error && <p style={{color: 'red'}}>{error}</p>}
          
          <input 
            type="text" 
            placeholder="Your Name" 
            value={playerName} 
            onChange={e => setPlayerName(e.target.value)} 
          />
          
          <button className="btn" onClick={createRoom}>Create New Game</button>
          
          <div style={{margin: '20px 0', borderBottom: '1px solid #ddd'}}></div>
          
          <input 
            type="text" 
            placeholder="Room Code" 
            value={roomId} 
            onChange={e => setRoomId(e.target.value.toUpperCase())}
            maxLength={4}
          />
          <button className="btn secondary" onClick={joinRoom}>Join Game</button>
        </div>
      </>
    );
  }

  const myPlayer = room.players.find(p => p.id === socket?.id);
  const isMyTurn = room.players[room.currentTurnIndex]?.id === socket?.id;
  const currentTurnPlayerName = room.players[room.currentTurnIndex]?.name;

  return (
    <>
      {renderBackground()}
      <div className="app-container">
        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '20px'}}>
          <div style={{fontWeight: 'bold', color: 'var(--secondary-color)'}}>Room: {room.roomId}</div>
          <div style={{fontWeight: 'bold'}}>Score: {myPlayer?.score} ⭐</div>
        </div>

        {room.phase === 'LOBBY' && (
          <div>
            <h2>Waiting for players...</h2>
            <div className="players-list">
              {room.players.map((p, i) => (
                <div key={i} className="player-item">
                  <span>{p.name} {p.id === room.players[0].id ? '👑' : ''}</span>
                  <span>{p.score} ⭐</span>
                </div>
              ))}
            </div>
            {room.players.length > 1 ? (
              room.players[0].id === socket.id ? (
                <button className="btn" onClick={startGame}>Start Game</button>
              ) : (
                <p>Waiting for host to start...</p>
              )
            ) : (
              <p>Need at least 2 players to start!</p>
            )}
          </div>
        )}

        {room.phase === 'RECORDING' && (
          <div>
            {isMyTurn ? (
              <div>
                <h2>It's your turn, {myPlayer.name}!</h2>
                <p>Make a sound like this animal:</p>
                <div className="animal-emoji">{room.currentAnimal.emoji}</div>
                <div className="record-btn-container">
                  <button 
                    className={`record-btn ${isRecording ? 'recording' : ''}`}
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                  >
                    {isRecording ? 'Recording...' : 'Hold to Record'}
                  </button>
                  <p style={{marginTop: '10px', fontSize: '0.9rem', color: '#666'}}>
                    (Hold button to record, up to 5s)
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <h2>Wait!</h2>
                <div className="animal-emoji">🤫</div>
                <p><strong>{currentTurnPlayerName}</strong> is recording an animal sound...</p>
              </div>
            )}
          </div>
        )}

        {room.phase === 'GUESSING' && (
          <div>
            <h2>Listen & Guess!</h2>
            {room.currentAudio && (
              <audio src={room.currentAudio} autoPlay controls style={{width: '100%', marginBottom: '20px'}} />
            )}
            
            {isMyTurn ? (
              <div>
                <p>Waiting for others to guess...</p>
                <div className="players-list">
                  {room.players.filter(p => p.id !== socket.id).map(p => {
                    const hasGuessed = room.guesses.some(g => g.playerId === p.id);
                    return (
                      <div key={p.id} className="player-item">
                        <span>{p.name}</span>
                        <span>{hasGuessed ? '✅ Guessed' : '🤔 Thinking'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                {room.guesses.some(g => g.playerId === socket.id) ? (
                  <p>You guessed! Waiting for others...</p>
                ) : (
                  <div className="options-grid">
                    {room.options.map((opt, i) => (
                      <button key={i} className="option-btn" onClick={() => submitGuess(opt.id)}>
                        <span style={{fontSize: '2rem'}}>{opt.emoji}</span>
                        <span style={{fontSize: '1rem', marginTop: '5px'}}>{opt.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {room.phase === 'REVEAL' && (
          <div>
            <h2>It was a {room.currentAnimal.name}!</h2>
            <div className="animal-emoji">{room.currentAnimal.emoji}</div>
            
            <div className="players-list">
              <h3 style={{marginTop: 0, marginBottom: '10px'}}>Results:</h3>
              {room.players.filter(p => p.id !== room.players[room.currentTurnIndex].id).map(p => {
                const guess = room.guesses.find(g => g.playerId === p.id);
                const isCorrect = guess && guess.animalId === room.currentAnimal.id;
                return (
                  <div key={p.id} className="player-item" style={{color: isCorrect ? 'green' : 'red'}}>
                    <span>{p.name}</span>
                    <span>{isCorrect ? '+10 ⭐' : '0 ⭐'}</span>
                  </div>
                );
              })}
            </div>

            {room.players[0].id === socket.id ? (
              <button className="btn" onClick={nextTurn}>Next Turn</button>
            ) : (
              <p>Waiting for host to continue...</p>
            )}
          </div>
        )}

      </div>
    </>
  );
}

export default App;
