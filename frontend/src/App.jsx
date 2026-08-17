import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './index.css';

// Use the current hostname but port 3001 in development (allows LAN testing)
const SOCKET_URL = (window.location.hostname === 'localhost' || window.location.port === '5173')
  ? `http://${window.location.hostname}:3001`
  : '/';

const compressImage = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400;
        const MAX_HEIGHT = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

function App() {
  const [socket, setSocket] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [rounds, setRounds] = useState(2);
  const [customDeck, setCustomDeck] = useState([]);

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
    socket.emit('start_game', { roomId: room.roomId, rounds, customDeck });
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    const newItems = await Promise.all(files.map(async (file, index) => {
      const base64 = await compressImage(file);
      return {
        id: `custom_${Date.now()}_${index}`,
        name: file.name.split('.')[0], // Default name
        emoji: '🖼️', // Fallback emoji
        image: base64
      };
    }));
    setCustomDeck([...customDeck, ...newItems]);
  };

  const updateCustomName = (id, newName) => {
    setCustomDeck(customDeck.map(item => item.id === id ? { ...item, name: newName } : item));
  };
  
  const removeCustomItem = (id) => {
    setCustomDeck(customDeck.filter(item => item.id !== id));
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

  const returnToLobby = () => {
    socket.emit('return_to_lobby', room.roomId);
  };

  // Render Background Bubbles
  const renderBackground = () => (
    <ul className="bg-bubbles">
      <li></li><li></li><li></li><li></li><li></li>
      <li></li><li></li><li></li><li></li><li></li>
    </ul>
  );

  const renderAnimalDisplay = (animal) => {
    if (animal.image) {
      return <img src={animal.image} alt={animal.name} style={{ width: '150px', height: '150px', objectFit: 'cover', borderRadius: '15px', margin: '10px auto', display: 'block', boxShadow: '0 4px 8px rgba(0,0,0,0.1)' }} />;
    }
    return <div className="animal-emoji">{animal.emoji}</div>;
  };

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
                <div style={{ marginTop: '20px' }}>
                  <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <label style={{ fontWeight: 'bold' }}>Rounds per player: </label>
                    <input 
                      type="number" 
                      min="1" 
                      max="10" 
                      value={rounds} 
                      onChange={(e) => setRounds(Number(e.target.value))} 
                      style={{ width: '60px', padding: '8px', margin: 0, textAlign: 'center' }} 
                    />
                  </div>
                  <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.5)', padding: '15px', borderRadius: '10px' }}>
                    <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem' }}>🖼️ Custom Images (Optional)</h3>
                    <p style={{ fontSize: '0.85rem', margin: '0 0 10px 0', color: '#444' }}>Upload at least 4 images to play with your own pictures!</p>
                    <input type="file" multiple accept="image/*" onChange={handleImageUpload} style={{ marginBottom: '10px', fontSize: '0.9rem', maxWidth: '100%' }} />
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                      {customDeck.map(item => (
                        <div key={item.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#fff', padding: '8px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                          <img src={item.image} alt={item.name} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '5px' }} />
                          <input type="text" value={item.name} onChange={e => updateCustomName(item.id, e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '4px', fontSize: '0.8rem', textAlign: 'center', boxSizing: 'border-box' }} />
                          <button onClick={() => removeCustomItem(item.id)} style={{ color: 'red', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', marginTop: '4px' }}>Remove</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button className="btn" onClick={startGame} disabled={customDeck.length > 0 && customDeck.length < 4}>
                    {customDeck.length > 0 && customDeck.length < 4 ? 'Need 4+ Images' : 'Start Game'}
                  </button>
                </div>
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
                {renderAnimalDisplay(room.currentAnimal)}
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
                        {opt.image ? (
                          <img src={opt.image} alt={opt.name} style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '8px', marginBottom: '5px', display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />
                        ) : (
                          <span style={{fontSize: '2rem', display: 'block'}}>{opt.emoji}</span>
                        )}
                        <span style={{fontSize: '1rem'}}>{opt.name}</span>
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
            {renderAnimalDisplay(room.currentAnimal)}
            
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

        {room.phase === 'GAME_OVER' && (
          <div>
            <h2>Game Over! 🏆</h2>
            <p>Final Scores:</p>
            
            <div className="players-list">
              {room.players.sort((a,b) => b.score - a.score).map((p, i) => (
                <div key={p.id} className="player-item">
                  <span>{i === 0 ? '🥇 ' : ''}{p.name}</span>
                  <span>{p.score} ⭐</span>
                </div>
              ))}
            </div>

            {room.players[0].id === socket.id ? (
              <button className="btn" onClick={returnToLobby}>Play Again</button>
            ) : (
              <p>Waiting for host to start a new game...</p>
            )}
          </div>
        )}

      </div>
    </>
  );
}

export default App;
