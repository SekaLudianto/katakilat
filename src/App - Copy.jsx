import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Trophy, Clock, BookOpen, CheckCircle, XCircle, Info, Upload, Loader, Database, Trash2, AlignLeft, ALargeSmall, LayoutGrid, Shuffle, Moon, Sun, Dices, Users, Wifi, WifiOff, Crown, Volume2, VolumeX, Bell, RefreshCw, Settings, MessageCircle, GripHorizontal, Minus, Maximize2, Bug, PauseCircle, PlayCircle, BookOpenText } from 'lucide-react';

// --- LOGIC AUTO-LOAD KHUSUS LOCALHOST (VITE) ---
let AUTO_LOADED_DATA = {};
try {
  const kbbiFiles = import.meta.glob('./data/*.json', { eager: true });
  for (const path in kbbiFiles) {
    const content = kbbiFiles[path].default || kbbiFiles[path];
    if (typeof content === 'object') {
      Object.keys(content).forEach(key => AUTO_LOADED_DATA[key.toLowerCase()] = content[key]);
    }
  }
} catch (err) { console.warn("Auto-load error:", err); }

// Data Fallback
const MOCK_KBBI = {
  "buku": { 
      "status": "success",
      "data": { "entri": [{ "nama": "bu.ku", "makna": [{ "submakna": ["lembar kertas yang berjilid"] }] }] } 
  },
  "cinta": { 
      "status": "success",
      "data": { "entri": [{ "nama": "cin.ta", "makna": [{ "submakna": ["suka sekali; sayang benar"] }] }] } 
  },
  "makan": { 
      "status": "success",
      "data": { "entri": [{ "nama": "ma.kan", "makna": [{ "submakna": ["memasukkan makanan ke mulut"] }] }] } 
  },
  "minum": { 
      "status": "success",
      "data": { "entri": [{ "nama": "mi.num", "makna": [{ "submakna": ["memasukkan air ke mulut"] }] }] } 
  },
  "afagia": {
    "status": "success",
    "data": {
      "entri": [
        {
          "nama": "a.fa.gi.a",
          "makna": [
            { "submakna": ["ketakmampuan untuk menelan"] }
          ]
        }
      ]
    }
  },
  "dahar": {
    "status": "success",
    "data": {
      "entri": [
        {
          "nama": "da.har",
          "makna": [
            { 
                "submakna": ["makan"],
                "kelas": [
                    { "kode": "v", "nama": "Verba", "deskripsi": "kata kerja" },
                    { "kode": "Jw", "nama": "Jawa", "deskripsi": "bahasa Jawa" }
                ]
            }
          ]
        }
      ]
    }
  }
};

const INITIAL_DATA = Object.keys(AUTO_LOADED_DATA).length > 0 ? AUTO_LOADED_DATA : MOCK_KBBI;

// --- KONFIGURASI GAME LIVE ---
const ROUND_DURATION = 45; // Durasi per ronde (detik)
const RESULT_DISPLAY_DURATION = 8000; // Durasi tampilan pemenang ronde (ms)
const RESTART_DELAY = 30; // Detik waktu tunggu sebelum restart otomatis
const WS_PORT = 62024; // Port Default IndoFinity

const MODE_CLASSIC = 'classic';
const MODE_DEF = 'definition';
const MODE_WORDLE = 'wordle_auto';
const MODE_SCRAMBLE = 'scramble';

export default function App() {
  // --- STATE SYSTEM ---
  const [isConnected, setIsConnected] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true); // Default Dark Mode
  const [notification, setNotification] = useState(null); 
  const [isMuted, setIsMuted] = useState(false); // Audio State
  
  // State WebSocket URL Dinamis
  const [wsUrl, setWsUrl] = useState(`ws://localhost:${WS_PORT}`);
  const [inputAddress, setInputAddress] = useState(`localhost:${WS_PORT}`); 

  const [gameState, setGameState] = useState('menu'); 
  const [gameMode, setGameMode] = useState(MODE_CLASSIC);
  
  const [challengeQueue, setChallengeQueue] = useState([]);
  const [challengeIndex, setChallengeIndex] = useState(0);

  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION);
  const [resultTimer, setResultTimer] = useState(0);
  const [restartTimer, setRestartTimer] = useState(RESTART_DELAY); // Timer untuk auto restart
  const [isPaused, setIsPaused] = useState(false); // New Pause State for Host

  const [dictionary, setDictionary] = useState(INITIAL_DATA);
  
  const [startLetter, setStartLetter] = useState('?');
  const [endLetter, setEndLetter] = useState('?');
  const [targetWordObj, setTargetWordObj] = useState(null); 
  const [wordleFlash, setWordleFlash] = useState(null); 
  const [isShuffling, setIsShuffling] = useState(false);

  // Stats Khusus Mode Classic
  const [classicStats, setClassicStats] = useState({ total: 0, words: [] });
  
  // State untuk animasi rotasi kata
  const [resultWordIndex, setResultWordIndex] = useState(0);
  const [showResultWord, setShowResultWord] = useState(true);
  
  // LIVE CHAT & WINNERS
  const [recentChats, setRecentChats] = useState([]); 
  const [roundWinners, setRoundWinners] = useState([]); 
  const [globalLeaderboard, setGlobalLeaderboard] = useState({});

  // Pagination States untuk Winner & Leaderboard
  const [winnerPage, setWinnerPage] = useState(0);
  const [lbPage, setLbPage] = useState(0);

  // --- DRAGGABLE CHAT STATE ---
  const [chatPosition, setChatPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [chatScale, setChatScale] = useState(1); // 1 = Normal, 0.7 = Kecil
  const dragStartRef = useRef({ x: 0, y: 0 });

  const wordleIntervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const notifTimeoutRef = useRef(null);
  const audioCtxRef = useRef(null); // Ref untuk AudioContext
  
  const currentAnswerRef = useRef({ 
      mode: MODE_CLASSIC, 
      start: '', 
      end: '', 
      exact: '',
      isPlaying: false 
  });
  const roundWinnersRef = useRef(new Set());

  // --- AUDIO & TTS UTILITIES ---
  const initAudio = () => {
      if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume();
      }
  };

  const playTone = (type) => {
      if (isMuted) return;
      initAudio();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'success') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(500, now);
          osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);
          gain.gain.setValueAtTime(0.3, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
          osc.start(now);
          osc.stop(now + 0.5);
      } else if (type === 'tick') {
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(800, now);
          gain.gain.setValueAtTime(0.1, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
          osc.start(now);
          osc.stop(now + 0.05);
      } else if (type === 'start') {
          osc.type = 'sine';
          osc.frequency.setValueAtTime(300, now);
          osc.frequency.linearRampToValueAtTime(600, now + 0.3);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.6);
          osc.start(now);
          osc.stop(now + 0.6);
      }
  };

  const speakGoogle = (text) => {
      if (isMuted || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'id-ID';
      utter.rate = 1.1; 
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
  };

  // --- AUTO DETECT IP / HOSTNAME ---
  useEffect(() => {
    const hostname = window.location.hostname || 'localhost';
    const defaultAddr = `${hostname}:${WS_PORT}`;
    setInputAddress(defaultAddr);
    setWsUrl(`ws://${defaultAddr}`);
  }, []);

  // --- DRAGGABLE LOGIC ---
  const handleDragStart = (e) => {
      if(e.target.closest('button')) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      setIsDragging(true);
      dragStartRef.current = { x: clientX - chatPosition.x, y: clientY - chatPosition.y };
  };

  useEffect(() => {
      const handleDragMove = (e) => {
          if (!isDragging) return;
          if (e.cancelable) e.preventDefault();
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const clientY = e.touches ? e.touches[0].clientY : e.clientY;
          setChatPosition({ x: clientX - dragStartRef.current.x, y: clientY - dragStartRef.current.y });
      };
      const handleDragEnd = () => setIsDragging(false);
      if (isDragging) {
          window.addEventListener('mousemove', handleDragMove);
          window.addEventListener('mouseup', handleDragEnd);
          window.addEventListener('touchmove', handleDragMove, { passive: false });
          window.addEventListener('touchend', handleDragEnd);
      }
      return () => {
          window.removeEventListener('mousemove', handleDragMove);
          window.removeEventListener('mouseup', handleDragEnd);
          window.removeEventListener('touchmove', handleDragMove);
          window.removeEventListener('touchend', handleDragEnd);
      };
  }, [isDragging]);

  const handleManualConnect = () => {
      let addr = inputAddress.trim();
      addr = addr.replace('ws://', '').replace('wss://', '');
      setWsUrl(`ws://${addr}`);
      showNotification(`Menghubungkan ke ${addr}...`, 'info');
  };

  // --- SIMULATION LOGIC ---
  const simulateRoundWinners = () => {
      const dummies = Array.from({ length: 25 }).map((_, i) => ({
          uniqueId: `sim_user_${i}`,
          nickname: `Penonton Setia ${i + 1}`,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`,
          answer: "jawaban_benar",
          points: Math.floor(Math.random() * 50) + 10
      })).sort((a, b) => b.points - a.points);
      setRoundWinners(dummies);
      setTargetWordObj({ word: "dahar", display: "dahar", def: "makan", scrambled: "HADAR", origin: "Jawa" });
      setClassicStats({ total: 15, words: ["contoh", "lain", "kata", "test"] });
      setGameState('round_result');
      
      currentAnswerRef.current.mode = MODE_DEF;
      currentAnswerRef.current.exact = "dahar";
      speakGoogle("Ronde selesai. Inilah daftar pemenangnya.");
  };

  const simulateLeaderboard = () => {
      const dummies = {};
      Array.from({ length: 50 }).forEach((_, i) => {
          dummies[`sim_user_${i}`] = {
              nickname: `Top Player ${i + 1}`,
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 100}`,
              score: Math.floor(Math.random() * 10000) + 500
          };
      });
      setGlobalLeaderboard(dummies);
      setGameState('game_over');
      speakGoogle("Permainan selesai. Berikut adalah papan peringkat global.");
  };

  useEffect(() => {
    const initialCount = Object.keys(dictionary).length;
    if (initialCount > 0) {
        showNotification(`Siap! ${initialCount.toLocaleString()} kata berhasil dimuat.`, 'info');
    }
  }, []);

  // --- ANIMASI & SFX TICK ---
  useEffect(() => {
    let interval;
    if (gameState === 'round_result' && gameMode === MODE_CLASSIC && classicStats.words.length > 0) {
        setResultWordIndex(0);
        setShowResultWord(true);
        interval = setInterval(() => {
            setShowResultWord(false);
            setTimeout(() => {
                setResultWordIndex(prev => (prev + 1) % classicStats.words.length);
                setShowResultWord(true);
            }, 300);
        }, 2000); 
    }
    
    // SFX Tick Tock 5 Detik Terakhir
    if (gameState === 'playing' && timeLeft <= 5 && timeLeft > 0) {
        playTone('tick');
    }

    return () => clearInterval(interval);
  }, [gameState, gameMode, classicStats, timeLeft]);

  useEffect(() => {
    let interval;
    if (gameState === 'round_result') {
        setWinnerPage(0); 
        if (roundWinners.length > 5) {
            interval = setInterval(() => {
                setWinnerPage(prev => {
                    const maxPage = Math.ceil(roundWinners.length / 5);
                    return (prev + 1) % maxPage;
                });
            }, 4000); 
        }
    }
    return () => clearInterval(interval);
  }, [gameState, roundWinners.length]);

  useEffect(() => {
    let pageInterval;
    let restartInterval;

    if (gameState === 'game_over') {
        setLbPage(0); 
        const totalPlayers = Object.keys(globalLeaderboard).length - 3; 
        if (totalPlayers > 5) {
            pageInterval = setInterval(() => {
                setLbPage(prev => {
                    const maxPage = Math.ceil(totalPlayers / 5);
                    return (prev + 1) % maxPage;
                });
            }, 5000); 
        }

        setRestartTimer(RESTART_DELAY);
        restartInterval = setInterval(() => {
            setRestartTimer(prev => {
                if (prev <= 1) {
                    clearInterval(restartInterval);
                    startUltimateChallenge(); 
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }
    return () => {
        clearInterval(pageInterval);
        clearInterval(restartInterval);
    };
  }, [gameState, globalLeaderboard]);

  const showNotification = (message, type = 'success') => {
      if (notifTimeoutRef.current) clearTimeout(notifTimeoutRef.current);
      setNotification({ message, type });
      notifTimeoutRef.current = setTimeout(() => {
          setNotification(null);
      }, 4000);
  };

  useEffect(() => {
      const savedLb = localStorage.getItem('katakilat_leaderboard');
      if (savedLb) {
          try { setGlobalLeaderboard(JSON.parse(savedLb)); } 
          catch (e) { console.error("Error loading LB", e); }
      }
  }, []);

  useEffect(() => {
      if (Object.keys(globalLeaderboard).length > 0) {
          localStorage.setItem('katakilat_leaderboard', JSON.stringify(globalLeaderboard));
      }
  }, [globalLeaderboard]);

  const resetGlobalLeaderboard = () => {
      if(window.confirm("Hapus semua data leaderboard global?")) {
          setGlobalLeaderboard({});
          localStorage.removeItem('katakilat_leaderboard');
          showNotification("Leaderboard berhasil direset!", "success");
      }
  };

  // --- WEBSOCKET CONNECTION & REF UPDATE ---
  const handleIncomingChatRef = useRef(null);

  useEffect(() => {
    let ws;
    let retryInterval;

    const connect = () => {
        if (ws) ws.close();
        try {
            ws = new WebSocket(wsUrl);
            ws.onopen = () => { 
                console.log('IndoFinity Connected'); 
                setIsConnected(true); 
                showNotification('Terhubung ke TikTok Live Connector!', 'success');
            };
            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.event === 'chat' && handleIncomingChatRef.current) {
                        handleIncomingChatRef.current(message.data);
                    }
                } catch (err) { console.error('Parse Error:', err); }
            };
            ws.onclose = () => setIsConnected(false); 
            ws.onerror = (err) => ws.close();
        } catch (e) {
            console.error("Connection failed", e);
            setIsConnected(false);
        }
    };
    
    if (wsUrl) connect();
    retryInterval = setInterval(() => {
        if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    }, 5000);

    return () => { clearInterval(retryInterval); if(ws) ws.close(); };
  }, [wsUrl]);

  // --- LOGIC: Handle Chat Answer ---
  const handleIncomingChat = (data) => {
      const { uniqueId, nickname, comment, profilePictureUrl } = data;
      const currentState = currentAnswerRef.current;

      const now = new Date();
      const timeString = now.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');
      
      if (comment.trim().toLowerCase() === '!myrank') {
          const sortedEntries = Object.entries(globalLeaderboard).sort(([,a], [,b]) => b.score - a.score);
          const rankIndex = sortedEntries.findIndex(([id]) => id === uniqueId);
          
          let displayMsg = "";
          let speakMsg = "";

          if (rankIndex !== -1) {
              const score = sortedEntries[rankIndex][1].score;
              displayMsg = `👑 Rank #${rankIndex + 1} • ${score} Poin`;
              speakMsg = `${nickname} ada di peringkat ${rankIndex + 1}`;
          } else {
              displayMsg = `Belum ada skor. Ayo main!`;
              speakMsg = `${nickname}, ayo jawab biar dapat poin`;
          }
          
          speakGoogle(speakMsg);
          
          setRecentChats(prev => {
              const newChat = { 
                  id: Date.now() + Math.random(), 
                  nickname: "SYSTEM", 
                  comment: `@${nickname} ${displayMsg}`, 
                  avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=system", 
                  time: timeString,
                  isSystem: true 
              };
              return [newChat, ...prev].slice(0, 4); 
          });
          
          return; 
      }

      setRecentChats(prev => {
          const newChat = { 
              id: Date.now() + Math.random(), 
              nickname, 
              comment, 
              avatar: profilePictureUrl,
              time: timeString 
          };
          return [newChat, ...prev].slice(0, 4); 
      });

      if (!currentState.isPlaying) return;
      if (roundWinnersRef.current.has(uniqueId)) return;

      const rawLower = comment.toLowerCase();
      const strippedInput = rawLower.replace(/[^a-z]/g, ''); 
      const words = rawLower.split(/[^a-z]+/); 

      let isCorrect = false;
      let points = 0;
      let finalAnswer = "";

      if (currentState.mode === MODE_CLASSIC) {
          const s = currentState.start.toLowerCase();
          const e = currentState.end.toLowerCase();
          
          if (strippedInput.length >= 3 && strippedInput.startsWith(s) && strippedInput.endsWith(e) && dictionary[strippedInput]) {
              isCorrect = true;
              points = strippedInput.length; 
              finalAnswer = strippedInput;
          }
          else {
              const validWord = words.find(w => w.length >= 3 && w.startsWith(s) && w.endsWith(e) && dictionary[w]);
              if (validWord) {
                  isCorrect = true;
                  points = validWord.length;
                  finalAnswer = validWord;
              }
          }
      }
      else {
          const target = currentState.exact.toLowerCase();
          if (strippedInput === target) {
              isCorrect = true;
              points = target.length; 
              finalAnswer = target;
          }
          else if (words.includes(target)) {
              isCorrect = true;
              points = target.length;
              finalAnswer = target;
          }
      }

      if (isCorrect) {
          if (currentState.mode === MODE_WORDLE) {
              registerWinner(uniqueId, nickname, profilePictureUrl, finalAnswer, points);
              endRound(true);
              return;
          }
          playTone('success');
          if (Math.random() > 0.7) speakGoogle(`Benar, ${nickname}`); 
          
          registerWinner(uniqueId, nickname, profilePictureUrl, finalAnswer, points);
      }
  };

  useEffect(() => {
      handleIncomingChatRef.current = handleIncomingChat;
  });

  const registerWinner = (uniqueId, nickname, avatar, answer, points) => {
      roundWinnersRef.current.add(uniqueId);
      setRoundWinners(prev => [{ uniqueId, nickname, avatar, answer, points }, ...prev]);
      setGlobalLeaderboard(prev => {
          const currentData = prev[uniqueId] || { nickname, avatar, score: 0 };
          return {
              ...prev,
              [uniqueId]: { nickname, avatar, score: currentData.score + points }
          };
      });
  };

  const availableWords = useMemo(() => {
    return Object.keys(dictionary).filter(word => word && word.length > 0);
  }, [dictionary]);

  const startUltimateChallenge = () => {
      if (availableWords.length === 0) return;
      let queue = [
          ...Array(3).fill(MODE_CLASSIC),
          ...Array(3).fill(MODE_DEF),
          ...Array(3).fill(MODE_WORDLE),
          ...Array(3).fill(MODE_SCRAMBLE)
      ];
      for (let i = queue.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      setChallengeQueue(queue);
      setChallengeIndex(0);
      prepareRound(queue[0]);
  };

  const prepareRound = (mode) => {
      setGameMode(mode);
      setGameState('playing');
      setTimeLeft(ROUND_DURATION);
      setRoundWinners([]);
      setRecentChats([]); 
      setTargetWordObj(null); 
      setIsPaused(false); // Reset pause state
      roundWinnersRef.current = new Set();
      
      currentAnswerRef.current = {
          mode: mode,
          start: '',
          end: '',
          exact: '', 
          isPlaying: true
      };
      
      initAudio();
      playTone('start');
      
      setupChallenge(mode);
  };

  const setupChallenge = (mode) => {
      setIsShuffling(true);
      if (wordleIntervalRef.current) clearInterval(wordleIntervalRef.current);
      
      if (mode === MODE_CLASSIC) {
           setTimeout(() => {
               let selectedWord = 'buku';
               let safety = 0;
               while (safety < 100) {
                   const w = availableWords[Math.floor(Math.random() * availableWords.length)];
                   if (w && /^[a-zA-Z]+$/.test(w) && w.length >= 3) {
                       selectedWord = w;
                       break;
                   }
                   safety++;
               }
               
               const cleanWord = selectedWord;
               const s = cleanWord.charAt(0).toLowerCase();
               const e = cleanWord.charAt(cleanWord.length - 1).toLowerCase();

               const matchingWords = availableWords.filter(w => 
                   w.toLowerCase().startsWith(s) && 
                   w.toLowerCase().endsWith(e) &&
                   /^[a-zA-Z]+$/.test(w) &&
                   w !== cleanWord 
               ).sort(() => Math.random() - 0.5);

               setClassicStats({ total: matchingWords.length, words: matchingWords });
               
               setStartLetter(s.toUpperCase());
               setEndLetter(e.toUpperCase());
               
               currentAnswerRef.current.start = s;
               currentAnswerRef.current.end = e;
               currentAnswerRef.current.exact = cleanWord; 
               
               setIsShuffling(false);
               speakGoogle(`Cari kata berawalan ${s.toUpperCase()}, dan berakhiran ${e.toUpperCase()}`);
           }, 1000);
      } 
      else if (mode === MODE_DEF || mode === MODE_SCRAMBLE || mode === MODE_WORDLE) {
          let selectedWord = 'makan';
          let safety = 0;
          while(safety < 100) {
              const w = availableWords[Math.floor(Math.random() * availableWords.length)];
              if (w.length >= 4 && w.length <= 8 && /^[a-zA-Z]+$/.test(w)) {
                  if (mode === MODE_DEF) {
                      const entry = dictionary[w]?.data?.entri?.[0];
                      if(entry?.makna?.[0]?.submakna?.[0]) { selectedWord = w; break; }
                  } else {
                      selectedWord = w; break;
                  }
              }
              safety++;
          }

          const entry = dictionary[selectedWord]?.data?.entri?.[0];
          const display = selectedWord; 
          const def = entry?.makna?.[0]?.submakna?.[0] || "Definisi tidak ditemukan";
          
          // DETEKSI BAHASA DAERAH
          let origin = null;
          const classes = entry?.makna?.[0]?.kelas;
          if (classes) {
              const standardClasses = ['Nomina', 'Verba', 'Adjektiva', 'Adverbia', 'Numeralia', 'Pronomina', 'Partikel'];
              const region = classes.find(c => !standardClasses.includes(c.nama));
              if(region) origin = region.nama;
          }

          let scrambled = selectedWord.toUpperCase().split('').sort(() => Math.random() - 0.5).join('');
          
          // Simpan 'origin' ke state
          setTargetWordObj({ word: selectedWord, display, def, scrambled, origin });
          
          currentAnswerRef.current.exact = selectedWord;

          if (mode === MODE_WORDLE) {
              startWordleStream(selectedWord);
              speakGoogle("Tebak kata misterius, siapa cepat dia dapat!");
          } else if (mode === MODE_SCRAMBLE) {
              speakGoogle("Susun huruf menjadi kata yang benar.");
          } else {
              speakGoogle("Tebak kata dari definisi berikut.");
          }
          setIsShuffling(false);
      }
  };

  const startWordleStream = (secret) => {
    const candidates = availableWords.filter(w => 
        w.length === secret.length && /^[a-zA-Z]+$/.test(w)
    );
    if (wordleIntervalRef.current) clearInterval(wordleIntervalRef.current);
    const updateFlash = () => {
        const guess = candidates.length > 0 
            ? candidates[Math.floor(Math.random() * candidates.length)] 
            : "?????"; 
        const feedback = calculateWordleFeedback(guess.toUpperCase(), secret.toUpperCase());
        setWordleFlash({ word: guess.toUpperCase(), feedback });
    };
    updateFlash();
    wordleIntervalRef.current = setInterval(updateFlash, 1500);
  };

  const calculateWordleFeedback = (guess, secret) => {
      const status = Array(guess.length).fill('absent');
      const secretArr = secret.split('');
      const guessArr = guess.split('');
      guessArr.forEach((c, i) => { if(c === secretArr[i]) { status[i] = 'correct'; secretArr[i] = null; }});
      guessArr.forEach((c, i) => { if(status[i] !== 'correct' && secretArr.includes(c)) { status[i] = 'present'; secretArr[secretArr.indexOf(c)] = null; }});
      return status;
  };

  useEffect(() => {
      let interval;
      if (gameState === 'playing' && !isShuffling) {
          interval = setInterval(() => {
              setTimeLeft(prev => {
                  if (prev <= 1) {
                      endRound();
                      return 0;
                  }
                  return prev - 1;
              });
          }, 1000);
      }
      return () => clearInterval(interval);
  }, [gameState, isShuffling]);

  const endRound = (forceEnd = false) => {
      currentAnswerRef.current.isPlaying = false;
      if (wordleIntervalRef.current) clearInterval(wordleIntervalRef.current);
      setGameState('round_result');
      setIsPaused(false); 
      
      const mode = currentAnswerRef.current.mode;
      const answer = currentAnswerRef.current.exact;
      const hasWinner = roundWinnersRef.current.size > 0;

      let speechText = "";

      if (mode === MODE_CLASSIC) {
          speechText = `Ronde selesai. Kata kuncinya adalah ${answer}`;
      } else if (mode === MODE_DEF) {
          speechText = `Ronde selesai. Jawabannya adalah ${answer}`;
      } else if (mode === MODE_SCRAMBLE) {
          speechText = `Ronde selesai. Susunan yang benar adalah ${answer}`;
      } else if (mode === MODE_WORDLE) {
          if (hasWinner) {
             speechText = `Hebat! Kata misteriusnya adalah ${answer}`;
          } else {
             speechText = `Waktu habis. Kata misteriusnya adalah ${answer}`;
          }
      }

      if (answer) speakGoogle(speechText);

      let countdown = RESULT_DISPLAY_DURATION / 1000;
      setResultTimer(countdown);
  };
  
  // --- EFFECT TIMER RESULT (HANDLE PAUSE) ---
  useEffect(() => {
      let interval;
      if (gameState === 'round_result') {
          interval = setInterval(() => {
              if (!isPaused) {
                  setResultTimer(prev => {
                      if (prev <= 1) {
                          clearInterval(interval);
                          nextRoundOrFinish();
                          return 0;
                      }
                      return prev - 1;
                  });
              }
          }, 1000);
      }
      return () => clearInterval(interval);
  }, [gameState, isPaused]); 

  const nextRoundOrFinish = () => {
      const nextIdx = challengeIndex + 1;
      if (nextIdx < challengeQueue.length) {
          setChallengeIndex(nextIdx);
          prepareRound(challengeQueue[nextIdx]);
      } else {
          setGameState('game_over');
          speakGoogle("Permainan selesai. Terima kasih sudah bermain.");
      }
  };

  const sortedRoundWinners = [...roundWinners].sort((a,b) => b.points - a.points);
  
  const sortedGlobalLeaderboard = Object.values(globalLeaderboard).sort((a,b) => b.score - a.score);
  const top3Players = sortedGlobalLeaderboard.slice(0, 3);
  const otherPlayers = sortedGlobalLeaderboard.slice(3);

  // --- THEME CONFIGURATION ---
  const themeClasses = isDarkMode ? {
    bg: "bg-[#0B1120]",
    textMain: "text-white", 
    textDim: "text-slate-300", 
    card: "bg-[#1E293B] border-slate-700 shadow-xl", 
    accent: "text-cyan-400",
    accentBg: "bg-cyan-500",
    slot: "bg-[#0F172A] border-slate-600 text-cyan-400 shadow-inner",
    btnPrimary: "bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500",
    winnerCard: "bg-slate-800 border-slate-600",
    defBox: "bg-slate-800 border-slate-600 text-slate-100", 
    wordleEmpty: "bg-slate-800 border-slate-600 text-slate-200" 
  } : {
    bg: "bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50", 
    textMain: "text-slate-700",
    textDim: "text-slate-500",
    card: "bg-gradient-to-b from-white/90 to-indigo-50/90 border-indigo-100 shadow-2xl backdrop-blur-sm", 
    accent: "text-indigo-600",
    accentBg: "bg-indigo-500",
    slot: "bg-indigo-50/80 border-indigo-200 text-indigo-700 shadow-sm",
    btnPrimary: "bg-gradient-to-r from-indigo-400 to-purple-400 text-white shadow-lg hover:shadow-indigo-200 hover:from-indigo-500 hover:to-purple-500",
    winnerCard: "bg-white/60 border-indigo-100 shadow-sm",
    defBox: "bg-gradient-to-br from-white/80 to-purple-50/50 border-indigo-100 shadow-lg text-slate-700",
    wordleEmpty: "bg-slate-100/80 border-slate-200 text-slate-400"
  };

  return (
    <div className={`min-h-screen font-sans overflow-hidden relative flex flex-col items-center justify-center transition-colors duration-500 ${themeClasses.bg}`}>
      
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, gray 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>
      {isDarkMode && (
        <>
            <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-purple-900/40 rounded-full blur-[120px] animate-pulse"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-blue-900/40 rounded-full blur-[120px] animate-pulse delay-1000"></div>
        </>
      )}

      {notification && (
        <div className={`absolute top-16 left-1/2 transform -translate-x-1/2 z-[60] flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl animate-in slide-in-from-top duration-300 ${notification.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'}`}>
             <CheckCircle className="w-5 h-5" />
             <span className="font-bold text-sm">{notification.message}</span>
        </div>
      )}

      <div className={`absolute top-4 left-4 z-50 flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs border shadow-lg transition-all ${isConnected ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-rose-500 text-white border-rose-600'}`}>
         {isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
         <span>{isConnected ? 'LIVE CONNECTED' : 'DISCONNECTED'}</span>
      </div>

      <div className="absolute top-4 right-4 z-50 flex gap-2">
           <button onClick={() => setIsMuted(!isMuted)} className={`p-3 rounded-full shadow-lg border transition-all ${isDarkMode ? 'bg-slate-800 border-slate-600 text-white hover:bg-slate-700' : 'bg-white/80 border-indigo-200 text-slate-600 hover:bg-white'}`}>
              {isMuted ? <VolumeX className="w-5 h-5"/> : <Volume2 className="w-5 h-5"/>}
           </button>
           <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-3 rounded-full shadow-lg border transition-all ${isDarkMode ? 'bg-slate-800 border-slate-600 text-yellow-400 hover:bg-slate-700' : 'bg-white/80 border-indigo-200 text-slate-600 hover:bg-white'}`}>
              {isDarkMode ? <Sun className="w-5 h-5"/> : <Moon className="w-5 h-5"/>}
           </button>
      </div>

      <div className={`w-full max-w-lg border-2 rounded-3xl p-6 m-4 z-10 relative flex flex-col min-h-[600px] transition-all duration-300 ${themeClasses.card}`}>
        
        <div className={`flex flex-col items-center justify-center transition-all duration-300 ${gameState === 'playing' ? 'mb-2' : 'mb-8'}`}>
           <div className={`p-2 rounded-xl mb-1 shadow-inner ${isDarkMode ? 'bg-slate-900/50' : 'bg-indigo-50/50'}`}>
                <BookOpen className={`w-6 h-6 ${themeClasses.accent}`} />
           </div>
           <h1 className={`text-2xl font-black tracking-tight ${themeClasses.textMain}`}>KATAKILAT</h1>
           {gameState === 'menu' && (
              <span className={`text-[10px] font-bold uppercase tracking-[0.3em] ${themeClasses.textDim}`}>Interactive Live Game</span>
           )}
        </div>

        {gameState === 'menu' && (
            <div className="flex-1 flex flex-col justify-center items-center text-center space-y-8">
                <div className="space-y-2">
                    <h2 className={`text-xl font-bold ${themeClasses.textMain}`}>Host Panel</h2>
                    <p className={`text-sm max-w-xs mx-auto ${themeClasses.textDim}`}>
                        Game show interaktif untuk TikTok Live. <br/>
                        Penonton menjawab melalui kolom komentar.
                    </p>
                </div>

                <div className="w-full space-y-4">
                    <button onClick={startUltimateChallenge} disabled={availableWords.length === 0} className={`w-full py-5 font-black text-xl rounded-2xl shadow-lg hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 ${themeClasses.btnPrimary}`}>
                        <Play className="fill-current w-6 h-6" /> MULAI SESI LIVE
                    </button>
                    
                    <div className="relative group">
                        <input type="file" multiple accept=".json" ref={fileInputRef} onChange={(e) => {
                             const file = e.target.files[0];
                             if(!file) return;
                             const reader = new FileReader();
                             reader.onload = (ev) => {
                                 try {
                                     const json = JSON.parse(ev.target.result);
                                     const newCount = Object.keys(json).length;
                                     setDictionary(prev => ({...prev, ...json}));
                                     showNotification(`Berhasil impor ${newCount} kata baru!`, 'success');
                                 } catch(err) { console.error(err); }
                             }
                             reader.readAsText(file);
                        }} className="hidden" />
                        <button onClick={() => fileInputRef.current.click()} className={`w-full py-3 rounded-xl font-bold text-sm border transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300' : 'bg-white/50 border-indigo-200 hover:bg-white/80 text-slate-600'}`}>
                            <Upload className="w-4 h-4 inline mr-2" /> Import Database Kata
                        </button>
                    </div>
                </div>
                
                <div className={`mt-auto p-4 rounded-xl text-left w-full border text-xs space-y-3 ${isDarkMode ? 'bg-slate-900/50 border-slate-700 text-slate-400' : 'bg-white/50 border-indigo-200 text-slate-600'}`}>
                    <div className="flex items-center gap-2 font-bold uppercase opacity-80">
                        <Settings className="w-3 h-3" /> Konfigurasi WebSocket
                    </div>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            value={inputAddress} 
                            onChange={(e) => setInputAddress(e.target.value)} 
                            placeholder="Contoh: 192.168.1.5:62024"
                            className={`flex-1 px-3 py-2 rounded-lg border bg-transparent outline-none transition-all ${isDarkMode ? 'border-slate-600 focus:border-cyan-500' : 'border-slate-300 focus:border-indigo-500'}`}
                        />
                        <button onClick={handleManualConnect} className={`px-3 py-2 rounded-lg border font-bold hover:opacity-80 transition-all ${isDarkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-indigo-100 border-indigo-200 text-indigo-700'}`}>
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="text-[10px] opacity-60">*Jika dibuka di HP, masukkan IP Laptop Anda (misal: 192.168.x.x:62024). Pastikan PC dan HP di WiFi yang sama.</div>
                    
                    <button onClick={resetGlobalLeaderboard} className="w-full flex items-center justify-center gap-2 text-[10px] text-red-400 opacity-60 hover:opacity-100 mt-2">
                        <Trash2 className="w-3 h-3" /> Reset Leaderboard Global
                    </button>

                    {/* TOMBOL SIMULASI */}
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-white/5">
                        <button onClick={simulateRoundWinners} className="flex items-center justify-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-400 py-2 rounded hover:bg-emerald-500/30">
                            <Bug className="w-3 h-3" /> Tes Pemenang
                        </button>
                        <button onClick={simulateLeaderboard} className="flex items-center justify-center gap-1 text-[10px] bg-blue-500/20 text-blue-400 py-2 rounded hover:bg-blue-500/30">
                            <Bug className="w-3 h-3" /> Tes Leaderboard
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* GAME CONTENT */}
        {gameState === 'playing' && (
            <div className="flex-1 flex flex-col relative overflow-hidden">
                <div className="flex justify-between items-center mb-4">
                    <div className={`px-3 py-1.5 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white/50 border-indigo-200'}`}>
                        <span className={`block text-[10px] font-bold uppercase tracking-wider ${themeClasses.textDim}`}>Ronde {challengeIndex+1}/12</span>
                        <span className={`block text-sm font-black ${themeClasses.textMain}`}>
                            {gameMode === MODE_CLASSIC ? 'AWAL-AKHIR' : gameMode === MODE_DEF ? 'TEBAK KATA' : gameMode === MODE_WORDLE ? 'WORDLE' : 'ANAGRAM'}
                        </span>
                    </div>
                    
                    <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-xl border-2 shadow-lg transition-all ${timeLeft <= 10 ? 'border-rose-500 bg-rose-500 text-white animate-pulse scale-110' : `${isDarkMode ? 'border-cyan-500 bg-slate-800 text-cyan-400' : 'border-indigo-400 bg-white/50 text-indigo-600'}`}`}>
                        <span className="text-xl font-black font-mono leading-none">{timeLeft}</span>
                    </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-start pt-0 relative w-full mb-20">
                    {gameMode === MODE_CLASSIC && (
                        <div className="flex flex-col items-center w-full animate-in fade-in zoom-in duration-500 mt-2">
                             <div className="flex items-center gap-2">
                                 <div className="flex flex-col items-center gap-1">
                                     <span className={`text-[10px] font-bold tracking-widest ${themeClasses.textDim}`}>AWALAN</span>
                                     <div className={`w-24 h-28 flex items-center justify-center text-6xl font-black rounded-2xl ${themeClasses.slot} ${isDarkMode ? 'shadow-[0_0_20px_rgba(34,211,238,0.2)]' : ''}`}>
                                         {startLetter}
                                     </div>
                                 </div>
                                 <div className={`w-4 h-1 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-slate-300'}`}></div>
                                 <div className="flex flex-col items-center gap-1">
                                     <span className={`text-[10px] font-bold tracking-widest ${themeClasses.textDim}`}>AKHIRAN</span>
                                     <div className={`w-24 h-28 flex items-center justify-center text-6xl font-black rounded-2xl ${themeClasses.slot} ${isDarkMode ? 'shadow-[0_0_20px_rgba(34,211,238,0.2)]' : ''}`}>
                                         {endLetter}
                                     </div>
                                 </div>
                             </div>
                             
                             {/* CLASSIC MODE INSTRUCTION GUIDE */}
                             <div className={`mt-6 flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-indigo-200 bg-indigo-50/50'}`}>
                                 <Info className={`w-4 h-4 ${themeClasses.textDim}`} />
                                 <span className={`text-xs font-medium ${themeClasses.textDim}`}>
                                     Ketik kata dengan <b>Awalan</b> & <b>Akhiran</b> di atas!
                                 </span>
                             </div>
                        </div>
                    )}

                    {gameMode === MODE_DEF && targetWordObj && (
                        <div className={`w-full p-4 rounded-2xl border text-center animate-in slide-in-from-bottom duration-500 mt-0 ${themeClasses.defBox}`}>
                            <span className={`text-xs font-black uppercase tracking-widest mb-2 block ${themeClasses.accent}`}>TEBAK KATA</span>
                            <p className="text-lg md:text-xl font-serif italic leading-relaxed mb-4">
                                "{targetWordObj.def}"
                            </p>
                            
                            {/* ADDED ORIGIN BADGE */}
                            {targetWordObj.origin && (
                                 <div className="mb-3">
                                     <span className={`text-[10px] px-2 py-0.5 rounded border ${isDarkMode ? 'bg-purple-900/30 text-purple-300 border-purple-700' : 'bg-purple-100 text-purple-700 border-purple-200'}`}>
                                         Asal: Bahasa {targetWordObj.origin}
                                     </span>
                                 </div>
                            )}

                            <div className={`inline-block px-3 py-1 rounded-lg text-xs font-mono font-bold ${isDarkMode ? 'bg-slate-900 text-slate-300' : 'bg-indigo-50 text-indigo-700'}`}>
                                {targetWordObj.word.length} Huruf • Awalan {targetWordObj.word.charAt(0).toUpperCase()}
                            </div>
                        </div>
                    )}

                    {gameMode === MODE_SCRAMBLE && targetWordObj && (
                        <div className="w-full mt-4">
                             <div className="text-center mb-4">
                                <span className={`text-xs font-black uppercase tracking-widest ${themeClasses.accent}`}>SUSUN KATA</span>
                             </div>
                             <div className="flex justify-center gap-2 w-full px-2 animate-in fade-in duration-500">
                                {targetWordObj.scrambled.split('').map((char, i) => (
                                    <div key={i} className={`flex-1 max-w-[3.5rem] aspect-[3/4] flex items-center justify-center text-xl sm:text-3xl font-black rounded-xl border-b-4 ${themeClasses.slot}`} style={{animationDelay: `${i*100}ms`}}>
                                        {char}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {gameMode === MODE_WORDLE && (
                        <div className="flex flex-col items-center w-full space-y-4 mt-4">
                            <div className="flex gap-2 justify-center w-full px-2">
                                {wordleFlash ? wordleFlash.word.split('').map((c, i) => {
                                    let color = themeClasses.wordleEmpty;
                                    if(wordleFlash.feedback[i] === 'correct') color = 'bg-emerald-500 border-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.5)]';
                                    if(wordleFlash.feedback[i] === 'present') color = 'bg-amber-500 border-amber-600 text-white';
                                    return (
                                        <div key={i} className={`flex-1 max-w-[3rem] aspect-[3/4] flex items-center justify-center text-lg sm:text-2xl font-black border-2 rounded-xl transition-colors duration-300 ${color}`}>
                                            {c}
                                        </div>
                                    )
                                }) : <Loader className="animate-spin"/>}
                            </div>
                            
                            {/* WORDLE COLOR LEGEND */}
                            <div className="flex gap-3 justify-center">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                                    <div className="w-3 h-3 bg-emerald-500 rounded-sm shadow-sm"></div>
                                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wide">Benar</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                                    <div className="w-3 h-3 bg-amber-500 rounded-sm shadow-sm"></div>
                                    <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wide">Geser</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-500/10 border border-slate-500/20">
                                    <div className="w-3 h-3 bg-slate-500 rounded-sm shadow-sm"></div>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Salah</span>
                                </div>
                            </div>

                            <div className={`px-4 py-1.5 rounded-full border ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white/50 border-indigo-200 text-slate-600 shadow-sm'}`}>
                                <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse">SIAPA CEPAT DIA DAPAT!</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* --- FLOATING & DRAGGABLE LIVE CHAT (MOVED OUTSIDE) --- */}
                <div 
                    className="fixed z-[100] w-full max-w-md px-4 cursor-move touch-none transition-transform duration-75 ease-out"
                    style={{ 
                        left: 0,
                        right: 0,
                        bottom: '1rem',
                        margin: '0 auto',
                        transform: `translate(${chatPosition.x}px, ${chatPosition.y}px) scale(${chatScale})`,
                        transformOrigin: 'bottom center'
                    }}
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                >
                    <div className="w-full space-y-2 relative group">
                        {/* Header Controls (Drag Handle + Resize) */}
                        <div className={`w-full flex justify-center items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${isDragging ? 'opacity-100' : ''}`}>
                            <button 
                                onClick={() => setChatScale(prev => prev === 1 ? 0.7 : 1)}
                                className="bg-black/30 backdrop-blur-sm rounded-full p-1 border border-white/10 hover:bg-black/50 transition-colors"
                            >
                                {chatScale === 1 ? <Minus className="w-3 h-3 text-white/70" /> : <Maximize2 className="w-3 h-3 text-white/70" />}
                            </button>
                            <div className="bg-black/30 backdrop-blur-sm rounded-full p-1 border border-white/10 cursor-grab active:cursor-grabbing">
                                <GripHorizontal className="w-4 h-4 text-white/70" />
                            </div>
                        </div>

                        {/* Judul Kecil Floating */}
                        {recentChats.length > 0 && (
                            <div className="absolute -top-6 left-2 flex items-center gap-1 opacity-50 pointer-events-none">
                                <MessageCircle className="w-3 h-3 text-emerald-400" />
                                <span className="text-[10px] font-bold tracking-widest uppercase text-white shadow-black drop-shadow-md">Live Chat</span>
                            </div>
                        )}

                        {/* List Chat */}
                        <div className="pointer-events-none"> 
                            {recentChats.length === 0 ? (
                                <div className={`py-3 px-4 rounded-xl border flex items-center justify-center gap-3 w-full animate-pulse ${isDarkMode ? 'bg-slate-900/80 border-slate-700/50 backdrop-blur-md' : 'bg-white/60 border-indigo-100 backdrop-blur-md'}`}>
                                    <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                                    <span className={`text-xs font-medium ${themeClasses.textDim}`}>Menunggu komentar penonton...</span>
                                </div>
                            ) : (
                                recentChats.map((chat) => (
                                    <div key={chat.id} className={`flex items-start gap-2 p-2 rounded-lg border animate-in slide-in-from-bottom fade-in duration-300 ${isDarkMode ? 'bg-black/60 border-white/10 backdrop-blur-md shadow-lg' : 'bg-white/80 border-white/60 shadow-lg backdrop-blur-md'} ${chat.isSystem ? 'border-yellow-500/50 bg-yellow-500/10' : ''}`}>
                                        <img src={chat.avatar} alt="" className="w-8 h-8 rounded-full border border-white/20 mt-0.5 bg-gray-500" />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className={`text-xs font-bold truncate max-w-[100px] ${chat.isSystem ? 'text-yellow-400' : themeClasses.textMain}`}>{chat.nickname}</span>
                                                <span className="text-[9px] font-mono opacity-70 bg-black/30 px-1.5 rounded text-white">{chat.time}</span>
                                            </div>
                                            <p className={`text-xs leading-tight break-words ${chat.isSystem ? 'text-yellow-200 font-bold' : (isDarkMode ? 'text-slate-200' : 'text-slate-700')}`}>{chat.comment}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* --- LIVE FEEDBACK BAR (UPDATED NOTIFICATION) --- */}
                <div className={`mt-auto mb-12 py-3 px-4 rounded-xl border flex items-center justify-center gap-3 transition-colors duration-300 ${roundWinners.length > 0 ? (isDarkMode ? 'bg-green-900/80 border-green-700' : 'bg-green-100 border-green-200') : (isDarkMode ? 'bg-slate-900/80 border-slate-700' : 'bg-white/60 border-indigo-100 shadow-sm')}`}>
                     {roundWinners.length > 0 ? (
                         <>
                           <Crown className="w-4 h-4 text-yellow-500 animate-bounce" />
                           <span className={`text-sm font-bold truncate max-w-[200px] ${isDarkMode ? 'text-green-200' : 'text-green-700'}`}>
                              {roundWinners[0].nickname} Menjawab Benar! (+{roundWinners[0].points})
                           </span>
                         </>
                     ) : (
                         <>
                           <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></div>
                           <span className={`text-sm font-medium ${themeClasses.textDim}`}>Menunggu jawaban komentar...</span>
                         </>
                     )}
                </div>
            </div>
        )}

        {/* --- OVERLAY: ROUND RESULT (PAGINATED & COMPACT & PAUSABLE) --- */}
        {gameState === 'round_result' && (
            <div className="absolute inset-0 z-40 backdrop-blur-md bg-black/50 flex flex-col items-center justify-center p-6 animate-in fade-in duration-300 rounded-3xl">
                
                {/* --- PAUSE OVERLAY (DETAIL & EXPLANATION) --- */}
                {isPaused ? (
                    <div className={`w-full max-w-sm rounded-3xl p-6 shadow-2xl border-2 relative animate-in zoom-in duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-600' : 'bg-white border-indigo-200'}`}>
                        <div className="flex justify-between items-center mb-4">
                           <div className="flex items-center gap-2">
                               <BookOpenText className="w-5 h-5 text-yellow-400" />
                               <span className="font-bold text-sm text-yellow-400 uppercase tracking-widest">Kamus Detail</span>
                           </div>
                           {targetWordObj?.origin && (
                               <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30">
                                   Bahasa {targetWordObj.origin}
                               </span>
                           )}
                        </div>

                        <div className="text-center py-4">
                            <h2 className={`text-4xl font-black mb-2 uppercase tracking-wide ${themeClasses.accent}`}>
                                {targetWordObj?.word || (currentAnswerRef.current.exact || '...')}
                            </h2>
                            <p className={`text-sm italic leading-relaxed opacity-80 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                                "{targetWordObj?.def || 'Definisi tidak tersedia'}"
                            </p>
                        </div>

                        <button onClick={() => setIsPaused(false)} className="w-full mt-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all">
                            <PlayCircle className="w-5 h-5" /> Lanjut (Resume)
                        </button>
                    </div>
                ) : (
                    // --- STANDARD RESULT VIEW ---
                    <div className={`w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl border-2 relative ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white/90 border-indigo-200'}`}>
                        {/* PAUSE BUTTON (Enable for Scramble, Wordle, and Definition) */}
                        {(gameMode === MODE_SCRAMBLE || gameMode === MODE_WORDLE || gameMode === MODE_DEF) && (
                            <button onClick={() => setIsPaused(true)} className="absolute top-4 right-4 text-white/30 hover:text-yellow-400 transition-colors">
                                <PauseCircle className="w-6 h-6" />
                            </button>
                        )}

                        <h2 className={`text-xl font-bold mb-1 ${themeClasses.textDim}`}>JAWABANNYA</h2>
                        
                        <div className={`text-3xl font-black uppercase tracking-wider ${themeClasses.accent}`}>
                            {targetWordObj?.word || (currentAnswerRef.current.exact || '...')}
                        </div>

                        {gameMode === MODE_CLASSIC && (
                            <div className="flex flex-col items-center justify-center mt-3 mb-6">
                                <span className={`text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1 ${themeClasses.textMain}`}>
                                    {classicStats.total} JAWABAN LAIN:
                                </span>
                                <div className={`h-8 flex items-center justify-center transition-opacity duration-300 ${showResultWord ? 'opacity-100' : 'opacity-0'}`}>
                                    <span className={`text-xl font-black ${themeClasses.textMain} uppercase tracking-wider`}>
                                        {classicStats.words.length > 0 ? classicStats.words[resultWordIndex] : "-"}
                                    </span>
                                </div>
                            </div>
                        )}

                        {gameMode !== MODE_CLASSIC && <div className="mb-6"></div>}

                        <div className="border-t border-b py-2 my-2 min-h-[180px] border-gray-200/10 relative"> 
                            <h3 className={`text-[10px] font-bold uppercase mb-2 flex justify-between px-2 ${themeClasses.textDim}`}>
                                <span>Pemenang Ronde</span>
                                <span>{roundWinners.length} Orang</span>
                            </h3>
                            
                            {roundWinners.length === 0 ? (
                                <div className={`py-6 text-sm italic opacity-50 ${isDarkMode ? 'text-white' : 'text-slate-600'}`}>Tidak ada yang benar :(</div>
                            ) : (
                                <div key={winnerPage} className="space-y-1.5 animate-in fade-in slide-in-from-right duration-500"> 
                                    {sortedRoundWinners.slice(winnerPage * 5, (winnerPage + 1) * 5).map((winner, idx) => (
                                        <div key={idx} className={`flex items-center justify-between p-2 rounded-lg border ${themeClasses.winnerCard}`}> 
                                            <div className="flex items-center gap-2"> 
                                                <div className="relative">
                                                    <img src={winner.avatar} className="w-8 h-8 rounded-full bg-gray-300" alt=""/>
                                                    {(winnerPage * 5 + idx) === 0 && <Crown className="w-3 h-3 text-yellow-500 absolute -top-1 -right-1 fill-current"/>} 
                                                </div>
                                                <span className={`font-bold text-xs max-w-[120px] truncate ${themeClasses.textMain}`}>{winner.nickname}</span> 
                                            </div>
                                            <div className="font-black text-sm text-emerald-500">+{winner.points}</div> 
                                        </div>
                                    ))}
                                </div>
                            )}
                            
                            {/* Page Indicator */}
                            {roundWinners.length > 5 && (
                                <div className="absolute bottom-[-10px] left-0 w-full flex justify-center gap-1">
                                    {Array.from({ length: Math.ceil(roundWinners.length / 5) }).map((_, i) => (
                                        <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === winnerPage ? 'bg-emerald-500 w-3' : 'bg-slate-500/30'}`} />
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        <div className="flex flex-col items-center mt-4">
                            <div className="w-full bg-gray-200 h-1 rounded-full overflow-hidden mb-2">
                                <div className="bg-emerald-500 h-full transition-all duration-1000 ease-linear" style={{width: `${(resultTimer / (RESULT_DISPLAY_DURATION/1000)) * 100}%`}}></div>
                            </div>
                            <span className={`text-xs font-bold ${themeClasses.textDim}`}>Lanjut otomatis...</span>
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* --- OVERLAY: LEADERBOARD (SPLIT VIEW & COMPACT) --- */}
        {gameState === 'game_over' && (
            <div className="absolute inset-0 z-50 rounded-3xl overflow-hidden flex flex-col bg-slate-900">
                <div className="p-4 pt-6 text-center bg-gradient-to-b from-slate-800 to-slate-900 pb-6 shrink-0">
                    <Crown className="w-16 h-16 text-yellow-400 mx-auto mb-2 drop-shadow-[0_0_25px_rgba(250,204,21,0.6)] fill-current animate-bounce-slow" />
                    <h2 className="text-3xl font-black text-white mb-1">LEADERBOARD GLOBAL</h2>
                    <p className="text-slate-400 font-medium text-sm">Top Skor</p>
                </div>

                <div className="flex-1 -mt-6 bg-slate-950 rounded-t-[2.5rem] p-5 pt-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden relative">
                    
                    <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col relative">
                        {/* TOP 3 STATIC SECTION */}
                        {top3Players.length > 0 && (
                            <div className="mb-2 grid grid-cols-3 gap-2 items-end">
                                {/* Rank 2 (Left) */}
                                {top3Players[1] && (
                                   <div className="flex flex-col items-center p-1.5 rounded-xl border border-slate-500/30 bg-gradient-to-b from-slate-700/50 to-slate-800/50 relative">
                                       <div className="absolute -top-2.5 bg-slate-400 text-slate-900 font-bold text-[10px] px-1.5 py-0.5 rounded-full border border-slate-300 shadow-sm">#2</div>
                                       <img src={top3Players[1].avatar} className="w-10 h-10 rounded-full border-2 border-slate-400 mb-1" alt=""/>
                                       <span className="font-bold text-[10px] text-white truncate w-full text-center max-w-[60px]">{top3Players[1].nickname}</span>
                                       <span className="font-black text-xs text-slate-300">{top3Players[1].score}</span>
                                   </div>
                                )}

                                {/* Rank 1 (Center - Taller/Bigger) */}
                                {top3Players[0] && (
                                   <div className="flex flex-col items-center p-2 rounded-xl border border-yellow-500/50 bg-gradient-to-b from-yellow-700/20 to-yellow-900/20 relative transform -translate-y-1 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                                       <Crown className="w-5 h-5 text-yellow-400 absolute -top-6 animate-bounce" />
                                       <div className="absolute -top-2.5 bg-yellow-400 text-yellow-900 font-bold text-[10px] px-2 py-0.5 rounded-full border border-yellow-200 shadow-sm">#1</div>
                                       <img src={top3Players[0].avatar} className="w-12 h-12 rounded-full border-2 border-yellow-400 mb-1" alt=""/>
                                       <span className="font-bold text-[10px] text-yellow-100 truncate w-full text-center max-w-[70px]">{top3Players[0].nickname}</span>
                                       <span className="font-black text-sm text-yellow-400">{top3Players[0].score}</span>
                                   </div>
                                )}

                                {/* Rank 3 (Right) */}
                                {top3Players[2] && (
                                   <div className="flex flex-col items-center p-1.5 rounded-xl border border-orange-700/30 bg-gradient-to-b from-orange-800/20 to-slate-800/50 relative">
                                       <div className="absolute -top-2.5 bg-orange-600 text-orange-100 font-bold text-[10px] px-1.5 py-0.5 rounded-full border border-orange-400 shadow-sm">#3</div>
                                       <img src={top3Players[2].avatar} className="w-10 h-10 rounded-full border-2 border-orange-600 mb-1" alt=""/>
                                       <span className="font-bold text-[10px] text-white truncate w-full text-center max-w-[60px]">{top3Players[2].nickname}</span>
                                       <span className="font-black text-xs text-orange-400">{top3Players[2].score}</span>
                                   </div>
                                )}
                            </div>
                        )}

                        {/* REST PLAYERS DYNAMIC SECTION */}
                        <div className="relative flex flex-col justify-start min-h-[160px]"> 
                            {otherPlayers.length === 0 && top3Players.length === 0 ? (
                                <div className={`text-center mt-10 font-medium ${themeClasses.textDim}`}>Belum ada data permainan.</div>
                            ) : otherPlayers.length === 0 ? (
                                <div className={`text-center mt-4 text-xs ${themeClasses.textDim}`}>Belum ada penantang lain.</div>
                            ) : (
                                <div key={lbPage} className="space-y-2 animate-in fade-in slide-in-from-right duration-500 w-full">
                                    {otherPlayers.slice(lbPage * 5, (lbPage + 1) * 5).map((user, idx) => {
                                        const rank = lbPage * 5 + idx + 4; // Start from rank 4
                                        return (
                                            <div key={idx} className="flex items-center justify-between p-2 px-3 rounded-lg border border-slate-800 bg-slate-900/50">
                                                <div className="flex items-center gap-3">
                                                    <div className="font-bold text-sm w-6 text-center text-slate-500">#{rank}</div>
                                                    <img src={user.avatar} className="w-6 h-6 rounded-full border border-white/10" alt=""/>
                                                    <span className="font-bold text-xs text-slate-300 truncate max-w-[120px]">{user.nickname}</span>
                                                </div>
                                                <span className="font-bold text-sm text-slate-400">{user.score}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            
                            {/* Leaderboard Pagination Dots for Bottom List */}
                            {otherPlayers.length > 5 && (
                                <div className="absolute bottom-0 left-0 w-full flex justify-center gap-1 pb-1">
                                    {Array.from({ length: Math.ceil(otherPlayers.length / 5) }).map((_, i) => (
                                        <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === lbPage ? 'bg-white w-3' : 'bg-white/20'}`} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Countdown Footer inside the dark area */}
                    <div className="pt-4 mt-2 text-center z-10 bg-slate-950 shrink-0">
                         <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden mb-2">
                              <div className="bg-emerald-500 h-full transition-all duration-1000 ease-linear" style={{width: `${(restartTimer / RESTART_DELAY) * 100}%`}}></div>
                         </div>
                         <span className="text-xs text-slate-500">Game otomatis mulai dalam {restartTimer}s</span>
                    </div>
                </div>
            </div>
        )}

      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.5); border-radius: 10px; }
        @keyframes bounce-slow {
            0%, 100% { transform: translateY(-5%); }
            50% { transform: translateY(5%); }
        }
        .animate-bounce-slow { animation: bounce-slow 3s infinite ease-in-out; }
      `}</style>
    </div>
  );
}