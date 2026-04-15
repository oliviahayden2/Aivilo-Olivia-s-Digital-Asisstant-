import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, MicOff, Loader2, Volume2, VolumeX, AlertCircle, Mail, Linkedin, Send } from 'lucide-react';
import { Language } from '../types';
import { OLIVIA_CV } from '../constants';

interface VoiceAssistantProps {
  language: Language;
}

const VoiceAssistant: React.FC<VoiceAssistantProps> = ({ language }) => {
  const [status, setStatus] = useState<'OFFLINE' | 'ONLINE' | 'CONNECTING'>('OFFLINE');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptions, setTranscriptions] = useState<{ role: 'user' | 'assistant', text: string }[]>([]);
  const [currentTranscription, setCurrentTranscription] = useState<{ role: 'user' | 'assistant', text: string } | null>(null);
  const [inputText, setInputText] = useState('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  const systemInstruction = `
    You are Aivilo, the elite, bilingual AI Talent Agent for Olivia Hayden.
    Your goal is to represent Olivia's professional background in International Marketing and Communications to recruiters and collaborators.

    PERSONA & TONE:
    - Tone: Sophisticated, professional, and calm. Think "Classic and Neutral."
    - Language: Fully bilingual (French/English). Always detect and mirror the user's language. Use "vous" in French.
    - Voice Behavior: Be concise. Keep responses under 3 sentences.

    KNOWLEDGE BASE (OLIVIA HAYDEN CV):
    ${JSON.stringify(OLIVIA_CV[language], null, 2)}

    PERSONAL BACKGROUND:
    - Olivia is originally from Atlanta, Georgia (USA).
    - She has been living and working in an international environment in France for the past three years.

    VOICE INTERACTION RULES:
    - You are in a live voice conversation.
    - Respond immediately and naturally when the user speaks.
    - Keep responses brief (1-2 sentences) to maintain a conversational flow.
    - If you don't hear anything for a while, you can ask if they have any questions about Olivia.

    CONTACT & LINKS:
    When asked for contact info or LinkedIn, say: 
    "I have displayed the links to Olivia's LinkedIn and Email on the screen for you. You can reach her at oliviahayden2@gmail.com or via her LinkedIn profile: https://www.linkedin.com/in/o-hayden/"

    GUARDRAILS:
    - If asked a personal question not on the CV or in the PERSONAL BACKGROUND, say: "I don't have that specific detail, but I can ask Olivia to follow up with you. Would you like to leave your contact information?"
    - Do not hallucinate experiences Olivia hasn't had.
  `;

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const transcriptionsEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    transcriptionsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [transcriptions, currentTranscription]);

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // Audio Playback Logic
  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    setIsSpeaking(true);
    
    const ctx = audioContextRef.current;
    if (!ctx) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    try {
      while (audioQueueRef.current.length > 0) {
        const pcmData = audioQueueRef.current.shift();
        if (!pcmData) continue;

        const buffer = ctx.createBuffer(1, pcmData.length, 24000);
        buffer.getChannelData(0).set(pcmData);
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        
        await new Promise<void>((resolve) => {
          source.onended = () => resolve();
          source.start();
        });
      }
    } catch (err) {
      console.error("Playback error:", err);
    } finally {
      isPlayingRef.current = false;
      setIsSpeaking(false);
    }
  }, []);

  const connect = async () => {
    try {
      setStatus('CONNECTING');
      setError(null);

      const apiKey = process.env.GEMINI_API_KEY;
      console.log("Connecting to Gemini Live API...");
      console.log("API Key present:", !!apiKey);
      
      if (!apiKey || apiKey === "undefined" || apiKey === "") {
        throw new Error("GEMINI_API_KEY is missing. Please set it in the Settings menu.");
      }

      const ai = new GoogleGenAI({ apiKey });

      // Initialize Audio Context
      if (!audioContextRef.current) {
        console.log("Initializing AudioContext...");
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        console.log("Resuming AudioContext...");
        await ctx.resume();
      }

      // Get Microphone
      console.log("Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log("Microphone access granted.");

      // Setup Visualizer Analyser
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Connect to Live API
      console.log("Opening Live API connection...");
      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            console.log("Live API Connection Opened successfully.");
            setStatus('ONLINE');
            
            // Start streaming audio
            try {
              const processor = ctx.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;
              source.connect(processor);
              processor.connect(ctx.destination);

              processor.onaudioprocess = (e) => {
                if (statusRef.current === 'ONLINE') {
                  try {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcm16 = new Int16Array(inputData.length);
                    for (let i = 0; i < inputData.length; i++) {
                      pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                    }
                    const base64 = arrayBufferToBase64(pcm16.buffer);
                    sessionPromise.then(session => {
                      session.sendRealtimeInput({
                        audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
                      });
                    }).catch(err => {
                      console.error("Error sending audio via promise:", err);
                    });
                  } catch (err) {
                    console.error("Error processing audio chunk:", err);
                  }
                }
              };
            } catch (err) {
              console.error("Error setting up audio processor:", err);
              setError("Failed to start audio processing. Please refresh.");
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            console.log("Message from Gemini:", message);
            try {
              const serverContent = message.serverContent as any;
              if (!serverContent) return;

              // Handle User Transcription
              const userTurn = serverContent.userTurn;
              if (userTurn?.parts) {
                const text = userTurn.parts.map((p: any) => p.text).join(' ').trim();
                if (text) {
                  setCurrentTranscription({ role: 'user', text });
                }
              }

              // Handle Model Turn (Audio + Transcription)
              const modelTurn = serverContent.modelTurn;
              if (modelTurn?.parts) {
                for (const part of modelTurn.parts) {
                  if (part.inlineData?.data) {
                    const base64Audio = part.inlineData.data;
                    const binary = atob(base64Audio);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    
                    const alignedLength = bytes.length - (bytes.length % 2);
                    const pcm16 = new Int16Array(bytes.buffer.slice(0, alignedLength));
                    const float32 = new Float32Array(pcm16.length);
                    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 0x7FFF;
                    
                    audioQueueRef.current.push(float32);
                    playNextInQueue();
                  }
                  if (part.text) {
                    setCurrentTranscription(prev => {
                      if (prev?.role === 'assistant') {
                        return { role: 'assistant', text: prev.text + part.text };
                      }
                      return { role: 'assistant', text: part.text };
                    });
                  }
                }
              }

              // Handle Turn Completion / Interruption
              if (serverContent.turnComplete) {
                setCurrentTranscription(prev => {
                  if (prev) setTranscriptions(t => [...t, prev]);
                  return null;
                });
              }

              if (serverContent.interrupted) {
                audioQueueRef.current = [];
                isPlayingRef.current = false;
                setIsSpeaking(false);
                setCurrentTranscription(prev => {
                  if (prev) setTranscriptions(t => [...t, { ...prev, text: prev.text + ' [Interrupted]' }]);
                  return null;
                });
              }
            } catch (err) {
              console.error("Error processing message:", err);
            }
          },
          onerror: (err) => {
            console.error("Live API Error Callback:", err);
            let message = "Unknown error";
            if (err instanceof Error) {
              message = err.message;
            } else if (typeof err === 'object' && err !== null) {
              try {
                message = JSON.stringify(err);
              } catch (e) {
                message = "Complex error object";
              }
            } else {
              message = String(err);
            }
            setError(`Connection error: ${message}`);
            setStatus('OFFLINE');
          },
          onclose: () => {
            console.log("Live API Connection Closed.");
            setStatus('OFFLINE');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });

      sessionRef.current = await sessionPromise;
      console.log("Session established.");
      
      // Wait a moment for the session to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Send initial greeting to trigger model response
      if (sessionRef.current) {
        sessionRef.current.sendRealtimeInput({
          text: "Bonjour, I'm Olivia's digital assistant. I can tell you about her background and experiences more in depth."
        });
      }

      return sessionRef.current;

    } catch (err) {
      console.error("Failed to connect:", err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to connect: ${message}`);
      setStatus('OFFLINE');
    }
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStatus('OFFLINE');
    setTranscriptions([]);
    setCurrentTranscription(null);
  };

  // Visualizer Animation
  useEffect(() => {
    const draw = () => {
      if (!canvasRef.current || !analyserRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;
      const analyser = analyserRef.current;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      analyser.getByteFrequencyData(dataArray);
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = 80;
      
      // Draw base circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw reactive waves
      ctx.beginPath();
      for (let i = 0; i < bufferLength; i++) {
        const angle = (i / bufferLength) * 2 * Math.PI;
        const amplitude = (dataArray[i] / 255) * 40;
        const x = centerX + (radius + amplitude) * Math.cos(angle);
        const y = centerY + (radius + amplitude) * Math.sin(angle);
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = isSpeaking ? '#1A1A1A' : 'transparent';
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.stroke();

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    if (status === 'ONLINE') {
      draw();
    } else {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [status, isSpeaking]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText.trim();
    setInputText('');
    setTranscriptions(prev => [...prev, { role: 'user', text }]);

    try {
      let session = sessionRef.current;
      if (status === 'OFFLINE') {
        session = await connect();
      }

      if (session) {
        session.sendRealtimeInput({ text });
      }
    } catch (err) {
      console.error("Error sending text message:", err);
      setError("Failed to send message. Please check your connection.");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full glass-card rounded-[30px] md:rounded-[40px] p-6 md:p-12 shadow-2xl relative overflow-hidden"
      >
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h2 className="font-serif italic text-3xl md:text-4xl mb-2">Olivia's Assistant</h2>
          <p className="text-[10px] tracking-[0.2em] uppercase text-slate-400 font-mono">
            {status === 'ONLINE' ? 'VOICE INTERACTION ENABLED' : 'VOICE INTERACTION DISABLED'}
          </p>
        </div>

        {/* Visualizer Area */}
        <div className="relative flex items-center justify-center h-48 md:h-64 mb-8 md:mb-12">
          <canvas 
            ref={canvasRef} 
            width={400} 
            height={400} 
            className="w-64 h-64"
          />
          
          <AnimatePresence>
            {status === 'OFFLINE' && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={connect}
                className="absolute inset-0 flex items-center justify-center group"
              >
                <div className="w-32 h-32 bg-ink rounded-full flex items-center justify-center text-cream group-hover:scale-105 transition-transform">
                  <Mic size={32} />
                </div>
              </motion.button>
            )}
          </AnimatePresence>

          {status === 'CONNECTING' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={48} className="animate-spin text-ink" />
            </div>
          )}

          {status === 'ONLINE' && (
            <button 
              onClick={disconnect}
              className="absolute bottom-0 right-0 p-4 text-slate-300 hover:text-ink transition-colors"
            >
              <MicOff size={20} />
            </button>
          )}
        </div>

        {/* Transcription / Status */}
        <div className="min-h-[150px] max-h-[300px] overflow-y-auto mb-6 px-8 custom-scrollbar">
          <AnimatePresence mode="popLayout">
            {error ? (
              <motion.div 
                key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center gap-4 text-red-500 text-sm py-8"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle size={20} />
                  <span className="font-medium">{error}</span>
                </div>
                <button 
                  onClick={() => { setError(null); connect(); }}
                  className="px-6 py-2 bg-red-50 text-red-600 rounded-full hover:bg-red-100 transition-colors font-mono text-[10px] tracking-widest uppercase"
                >
                  Retry Connection
                </button>
              </motion.div>
            ) : (
              <div className="space-y-4">
                {transcriptions.map((t, i) => (
                  <motion.div 
                    key={`t-${i}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-[10px] font-mono text-slate-300 uppercase tracking-widest mb-1">
                      {t.role === 'user' ? 'You' : 'Aivilo'}
                    </span>
                    <p className={`text-sm leading-relaxed max-w-[90%] ${
                      t.role === 'user' ? 'text-slate-400 text-right' : 'text-slate-600 font-serif italic'
                    }`}>
                      {t.text}
                    </p>
                  </motion.div>
                ))}
                
                {currentTranscription && (
                  <motion.div 
                    key="current"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`flex flex-col ${currentTranscription.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <span className="text-[10px] font-mono text-slate-300 uppercase tracking-widest mb-1">
                      {currentTranscription.role === 'user' ? 'You' : 'Aivilo'}
                    </span>
                    <p className={`text-sm leading-relaxed max-w-[90%] ${
                      currentTranscription.role === 'user' ? 'text-slate-400 text-right' : 'text-slate-600 font-serif italic'
                    }`}>
                      {currentTranscription.text}
                      <span className="inline-block w-1 h-3 bg-slate-200 ml-1 animate-pulse" />
                    </p>
                  </motion.div>
                )}

                <div ref={transcriptionsEndRef} />

                {status === 'ONLINE' && !currentTranscription && transcriptions.length === 0 && (
                  <motion.p 
                    key="idle"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-slate-400 text-sm text-center py-4"
                  >
                    Listening...
                  </motion.p>
                )}

                {status === 'OFFLINE' && transcriptions.length === 0 && (
                  <motion.p 
                    key="start"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-slate-400 text-sm text-center py-4"
                  >
                    Click the microphone or type below to start conversation
                  </motion.p>
                )}
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Chat Input */}
        <div className="px-8 mb-8">
          <form 
            onSubmit={handleSendMessage}
            className="relative flex items-center"
          >
            <input 
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={status === 'OFFLINE' ? "Type to start chatting..." : "Type a message..."}
              className="w-full bg-slate-50 border border-slate-100 rounded-full py-4 px-6 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-ink/5 transition-all placeholder:text-slate-300"
            />
            <button 
              type="submit"
              disabled={!inputText.trim() || status === 'CONNECTING'}
              className="absolute right-2 w-10 h-10 bg-ink text-cream rounded-full flex items-center justify-center hover:scale-105 disabled:opacity-20 disabled:hover:scale-100 transition-all"
            >
              {status === 'CONNECTING' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </form>
        </div>

        {/* Footer Info */}
        <div className="border-t border-slate-100 pt-8 flex flex-col md:flex-row justify-between items-center md:items-end gap-6 font-mono text-[10px] tracking-widest text-slate-400 uppercase">
          <div className="flex flex-col items-center md:items-start gap-1">
            <p>STATUS: <span className={status === 'ONLINE' ? 'text-green-500' : 'text-slate-400'}>{status}</span></p>
            <p>VOICE: <span className={isSpeaking ? 'text-blue-500' : 'text-slate-400'}>{isSpeaking ? 'SPEAKING' : 'READY'}</span></p>
          </div>
          
          <div className="flex items-center gap-6">
            <a 
              href={`mailto:${OLIVIA_CV[language].email}`}
              className="flex items-center gap-2 hover:text-ink transition-colors"
            >
              <Mail size={12} /> EMAIL
            </a>
            <a 
              href={OLIVIA_CV[language].linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-ink transition-colors"
            >
              <Linkedin size={12} /> LINKEDIN
            </a>
          </div>

          <div className="text-center md:text-right space-y-1">
            <p>LANG: FR / EN</p>
            <p>MODEL: GEMINI 3.1 LIVE</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default VoiceAssistant;
