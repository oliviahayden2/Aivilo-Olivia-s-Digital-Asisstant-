export type Language = 'en' | 'fr';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface CVData {
  name: string;
  title: string;
  location: string;
  email: string;
  linkedin: string;
  summary: string;
  experience: Experience[];
  education: Education[];
  skills: {
    technical: string[];
    languages: string[];
    hobbies: string[];
  };
}

export interface Experience {
  role: string;
  company: string;
  period: string;
  location: string;
  highlights: string[];
}

export interface Education {
  degree: string;
  school: string;
  period: string;
  location: string;
  notes?: string;
}
