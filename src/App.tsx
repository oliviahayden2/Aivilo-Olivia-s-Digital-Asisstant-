import { useState } from 'react';
import VoiceAssistant from './components/VoiceAssistant';
import { Language } from './types';
import { Globe, Linkedin, Mail, MapPin } from 'lucide-react';
import { motion } from 'motion/react';
import { OLIVIA_CV } from './constants';

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const data = OLIVIA_CV[language];

  return (
    <div className="min-h-screen bg-cream selection:bg-ink selection:text-cream font-sans text-ink p-8 md:p-16">
      {/* Header Section */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center mb-32 gap-8">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-2"
        >
          <h1 className="text-7xl md:text-8xl font-serif tracking-tight leading-none">
            Olivia Hayden
          </h1>
          <p className="text-xs md:text-sm tracking-[0.4em] uppercase text-slate-400 font-mono">
            {language === 'en' ? 'Digital marketing and communication' : 'Marketing Digital & Communication'}
          </p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex flex-col items-end gap-6"
        >
          <div className="text-right font-mono text-[10px] md:text-xs tracking-widest uppercase text-slate-400 space-y-1">
            <p className="flex items-center justify-end gap-2"><MapPin size={12} /> PARIS, FRANCE</p>
          </div>
          
          <div className="flex items-center gap-4">
            <a 
              href={data.linkedin} 
              target="_blank" 
              rel="noopener noreferrer"
              className="group flex items-center gap-3 px-4 h-10 rounded-full border border-slate-200 hover:bg-ink hover:text-cream transition-all"
            >
              <Linkedin size={18} />
              <span className="text-[10px] font-mono tracking-widest uppercase hidden md:inline">LinkedIn</span>
            </a>
            <a 
              href={`mailto:${data.email}`}
              className="group flex items-center gap-3 px-4 h-10 rounded-full border border-slate-200 hover:bg-ink hover:text-cream transition-all"
              title={data.email}
            >
              <Mail size={18} />
              <span className="text-[10px] font-mono tracking-widest uppercase hidden md:inline">{data.email}</span>
            </a>
            <button 
              onClick={() => setLanguage(language === 'en' ? 'fr' : 'en')}
              className="px-4 h-10 rounded-full border border-slate-200 flex items-center justify-center hover:bg-ink hover:text-cream transition-all font-mono text-xs tracking-widest uppercase"
            >
              {language === 'en' ? 'FR' : 'EN'}
            </button>
          </div>
        </motion.div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto">
        {/* Intro Quote */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-24"
        >
          <p className="text-xl md:text-2xl font-serif italic text-slate-500 leading-relaxed max-w-2xl mx-auto">
            {language === 'en' 
              ? "\"I'm Olivia's digital assistant. I can tell you about her background and experiences more in depth.\""
              : "\"Je suis l'assistante numérique d'Olivia. Je peux vous parler de son parcours et de ses expériences plus en détail.\""}
          </p>
        </motion.section>

        {/* Voice Assistant Card */}
        <VoiceAssistant language={language} />
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto mt-40 pt-12 border-t border-slate-100 flex justify-between items-center text-[10px] font-mono tracking-[0.3em] uppercase text-slate-300">
        <p>© {new Date().getFullYear()} OLIVIA HAYDEN</p>
        <p>AIVILO v2.0 LIVE</p>
      </footer>
    </div>
  );
}
