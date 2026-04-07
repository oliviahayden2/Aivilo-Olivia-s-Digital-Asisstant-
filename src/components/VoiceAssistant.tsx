import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Mic, MicOff, Loader2, Volume2, VolumeX, AlertCircle } from 'lucide-react';
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
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
    if (audioQueueRef.current.length === 0 || isPlayingRef.current) return;
    
    isPlayingRef.current = true;
    setIsSpeaking(true);
    
    const ctx = audioContextRef.current;
    if (!ctx) return;

    while (audioQueueRef.current.length > 0) {
      const pcmData = audioQueueRef.current.shift()!;
      const buffer = ctx.createBuffer(1, pcmData.length, 24000);
      buffer.getChannelData(0).set(pcmData);
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      const playPromise = new Promise<void>((resolve) => {
        source.onended = () => resolve();
      });
      
      source.start();
      await playPromise;
    }
    
    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const connect = async () => {
    try {
      setStatus('CONNECTING');
      setError(null);

      // Initialize Audio Context
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      // Get Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Setup Visualizer Analyser
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Connect to Live API
      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onopen: () => {
            setStatus('ONLINE');
            
            // Start streaming audio
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(ctx.destination);

            processor.onaudioprocess = (e) => {
              if (statusRef.current === 'ONLINE' && sessionRef.current) {
                const inputData = e.inputBuffer.getChannelData(0);
                // Convert to 16-bit PCM
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }
                const base64 = arrayBufferToBase64(pcm16.buffer);
                sessionRef.current.sendRealtimeInput({
                  audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
                });
              }
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            const serverContent = message.serverContent as any;

            // Handle User Transcription
            const userParts = serverContent?.userTurn?.parts;
            if (userParts) {
              const text = userParts.map((p: any) => p.text).join(' ').trim();
              if (text) {
                setCurrentTranscription({ role: 'user', text });
              }
            }

            // Handle Model Turn (Audio + Transcription)
            const modelTurn = serverContent?.modelTurn;
            if (modelTurn) {
              const parts = modelTurn.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    const base64Audio = part.inlineData.data;
                    const binary = atob(base64Audio);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    const pcm16 = new Int16Array(bytes.buffer);
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
            }

            // Handle Turn Completion / Interruption
            if (serverContent?.turnComplete) {
              setCurrentTranscription(prev => {
                if (prev) setTranscriptions(t => [...t, prev]);
                return null;
              });
            }

            if (serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              setIsSpeaking(false);
              setCurrentTranscription(prev => {
                if (prev) setTranscriptions(t => [...t, { ...prev, text: prev.text + ' [Interrupted]' }]);
                return null;
              });
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            setStatus('OFFLINE');
          },
          onclose: () => {
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
      
      // Send initial greeting to trigger model response
      sessionRef.current.sendRealtimeInput({
        text: "Bonjour, I'm Olivia's digital assistant. I can tell you about her background and experiences more in depth."
      });

    } catch (err) {
      console.error("Failed to connect:", err);
      setError("Microphone access denied or connection failed.");
      setStatus('OFFLINE');
    }
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
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

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full glass-card rounded-[40px] p-12 shadow-2xl relative overflow-hidden"
      >
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="font-serif italic text-4xl mb-2">Olivia's Assistant</h2>
          <p className="text-xs tracking-[0.2em] uppercase text-slate-400 font-mono">
            {status === 'ONLINE' ? 'VOICE INTERACTION ENABLED' : 'VOICE INTERACTION DISABLED'}
          </p>
        </div>

        {/* Visualizer Area */}
        <div className="relative flex items-center justify-center h-64 mb-12">
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
        <div className="min-h-[120px] max-h-[200px] overflow-y-auto mb-12 px-8 custom-scrollbar">
          <AnimatePresence mode="popLayout">
            {error ? (
              <motion.div 
                key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex items-center justify-center gap-2 text-red-500 text-sm py-4"
              >
                <AlertCircle size={16} /> {error}
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
                    Click the microphone to start conversation
                  </motion.p>
                )}
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Info */}
        <div className="border-t border-slate-100 pt-8 flex justify-between items-end font-mono text-[10px] tracking-widest text-slate-400 uppercase">
          <div className="space-y-1">
            <p>STATUS: <span className={status === 'ONLINE' ? 'text-green-500' : 'text-slate-400'}>{status}</span></p>
            <p>VOICE: FEMALE (KORE)</p>
          </div>
          <div className="text-right space-y-1">
            <p>LANG: FR / EN</p>
            <p>MODEL: GEMINI 3.1 LIVE</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default VoiceAssistant;
