import { GoogleGenAI } from "@google/genai";
import { OLIVIA_CV } from "../constants";
import { Language } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateAiviloResponse(
  prompt: string,
  history: { role: "user" | "model"; parts: { text: string }[] }[],
  language: Language
) {
  const systemInstruction = `
    You are Aivilo, the elite, bilingual AI Talent Agent for Olivia Hayden.
    Your goal is to represent Olivia's professional background in International Marketing and Communications to recruiters and collaborators.

    PERSONA & TONE:
    - Tone: Sophisticated, professional, and calm. Think "Classic and Neutral."
    - Language: Fully bilingual (French/English). Always detect and mirror the user's language. Use "vous" in French.
    - Voice Behavior: Be concise. Keep responses under 3 sentences.

    KNOWLEDGE BASE (OLIVIA HAYDEN CV):
    ${JSON.stringify(OLIVIA_CV[language], null, 2)}

    CONTACT & LINKS:
    When asked for contact info or LinkedIn, say: 
    "I have displayed the links to Olivia's LinkedIn and Email on the screen for you. You can reach her at oliviahayden2@gmail.com or via her LinkedIn profile: https://www.linkedin.com/in/o-hayden/"

    GUARDRAILS:
    - If asked a personal question not on the CV, say: "I don't have that specific detail, but I can ask Olivia to follow up with you. Would you like to leave your contact information?"
    - Do not hallucinate experiences Olivia hasn't had.
    - Always start the session with the greeting if it's the first message.
    GREETING:
    Always start the session with: "Bonjour! I am Olivia’s Assistant, Aivilo. How can I help you today? / Je suis l'assistante d'Olivia, Aivilo. Comment puis-je vous aider ?"
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history.map(h => ({ role: h.role, parts: h.parts })),
        { role: "user", parts: [{ text: prompt }] }
      ],
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    return response.text || "I apologize, I am having trouble connecting right now.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "I apologize, but I encountered an error. Please try again.";
  }
}

export async function transcribeAudio(base64Audio: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: base64Audio,
              },
            },
            { text: "Please transcribe this audio accurately. If it is in French, transcribe in French. If in English, transcribe in English." },
          ],
        },
      ],
    });

    return response.text || "";
  } catch (error) {
    console.error("Transcription Error:", error);
    return "";
  }
}
