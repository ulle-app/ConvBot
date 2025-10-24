import { GoogleGenAI, LiveServerMessage, Modality, Blob } from "@google/genai";
import { AppStatus, TranscriptTurn, GroundingSource } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { playError, playStart, playStop } from "../utils/audioCues";

type TranscriptCallback = (turn: TranscriptTurn) => void;
type StatusCallback = (status: AppStatus, message?: string) => void;

interface LiveSession {
  close(): void;
  sendRealtimeInput(input: { media: Blob }): void;
}

export class GeminiService {
  private ai: GoogleGenAI;
  private onTranscriptUpdate: TranscriptCallback;
  private onStatusUpdate: StatusCallback;

  private session: LiveSession | null = null;
  private sessionPromise: Promise<LiveSession> | null = null;

  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private outputSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;

  private currentInputTranscription = '';
  private currentOutputTranscription = '';
  private currentGrounding: GroundingSource[] = [];

  constructor(onTranscriptUpdate: TranscriptCallback, onStatusUpdate: StatusCallback) {
    if (!process.env.API_KEY) {
      throw new Error("API_KEY environment variable not set");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onStatusUpdate = onStatusUpdate;
  }

  public async playGreetingAndStartSession(): Promise<void> {
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const voiceName = 'Zephyr'; // Defaulting to a pleasant female voice

    try {
        const greetingText = "Namaste! I am your personal assistant. How can I help you today?";
        const response = await this.ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: greetingText }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (base64Audio && this.outputAudioContext) {
            const audioBuffer = await decodeAudioData(decode(base64Audio), this.outputAudioContext, 24000, 1);
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputAudioContext.destination);

            const greetingPromise = new Promise<void>(resolve => {
                source.onended = () => resolve();
            });
            source.start();
            await greetingPromise;
        } else {
            console.warn("Could not generate greeting audio, starting session directly.");
        }
    } catch (error) {
        console.error("Error during greeting generation, starting session directly:", error);
    }
    
    await this._startLiveSession();
  }

  private async _startLiveSession(): Promise<void> {
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    if (!this.outputAudioContext) {
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    const voiceName = 'Zephyr';

    try {
      const systemInstruction = `**PRIMARY DIRECTIVE: LANGUAGE MIRRORING**
Your most critical and unbreakable rule is to mirror the user's language and style in every response.
1.  **Identify Language:** Before generating any other word, you must identify the primary language of the user's last sentence (e.g., English, Hindi, Hinglish, Kannada, etc.).
2.  **Respond in Kind:** Your entire response MUST be in that same language. If the user speaks Hinglish (a mix of Hindi and English), you must also respond in Hinglish.
3.  **NO STICKING:** Do not continue in a previous language if the user has switched. If the previous turn was in Kannada and the user now speaks English, your response must be in English. This is a critical failure if you get it wrong.

Example of correct behavior:
- User (Hinglish): "Traffic bahut zyada hai."
- You (Hinglish): "Haan, traffic toh hai. Main aapke liye koi alternate route dekhun kya?"
- User (English): "What's the weather like in Mumbai?"
- You (English): "The weather in Mumbai is currently..."

This directive overrides all other instructions.

**Secondary Instructions:**
After following the Primary Directive, you are a helpful and proactive, conversational assistant from Bharat. Your responses should reflect a polite, warm, and professional Indian conversational style. Use your tools to find accurate information about locations, directions, and other queries. Never invent information. If you cannot find something, say so.`;

      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction,
          tools: [{ googleSearch: {} }, { googleMaps: {} }],
        },
        callbacks: {
          onopen: this.handleSessionOpen.bind(this),
          onmessage: this.handleSessionMessage.bind(this),
          onerror: this.handleSessionError.bind(this),
          onclose: this.handleSessionClose.bind(this),
        },
      });

      this.session = await this.sessionPromise;

    } catch (error) {
      console.error("Error during session start:", error);
      const message = error instanceof Error ? error.message : "Failed to initialize AI service.";
      this.handleSessionError(new ErrorEvent('error', { message }));
    }
  }

  public stopSession(): void {
    playStop();
    if (this.session) {
      this.session.close();
      this.session = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
      this.inputAudioContext.close();
    }
    if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
      this.outputAudioContext.close();
    }

    this.outputSources.forEach(source => source.stop());
    this.outputSources.clear();
    this.sessionPromise = null;
  }

  private async handleSessionOpen() {
    this.onStatusUpdate(AppStatus.LISTENING);
    playStart();
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.inputAudioContext) return;

      this.source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

      this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        const pcmBlob = createBlob(inputData);
        if (this.sessionPromise) {
          this.sessionPromise.then((session) => {
            session.sendRealtimeInput({ media: pcmBlob });
          });
        }
      };

      this.source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputAudioContext.destination);

    } catch (err) {
      console.error("Microphone access denied:", err);
      this.onStatusUpdate(AppStatus.ERROR, "Microphone access denied. Please enable it in your browser settings.");
      this.stopSession();
    }
  }

  private async handleSessionMessage(message: LiveServerMessage) {
    if (message.serverContent?.interrupted) {
      for (const source of this.outputSources.values()) {
        source.stop();
      }
      this.outputSources.clear();
      this.nextStartTime = 0;

      if (this.currentOutputTranscription) {
        this.onTranscriptUpdate({ author: 'bot', text: this.currentOutputTranscription, isFinal: true, grounding: this.currentGrounding });
        this.currentOutputTranscription = '';
        this.currentGrounding = [];
      }
    }

    if (message.serverContent?.inputTranscription) {
      this.onStatusUpdate(AppStatus.PROCESSING);
      const text = message.serverContent.inputTranscription.text;
      this.currentInputTranscription = text;
      this.onTranscriptUpdate({ author: 'user', text: this.currentInputTranscription, isFinal: false });
    }

    if (message.serverContent?.outputTranscription) {
      this.onStatusUpdate(AppStatus.SPEAKING);
      const text = message.serverContent.outputTranscription.text;
      this.currentOutputTranscription += text;

      const groundingChunks = message.serverContent?.groundingMetadata?.groundingChunks;
      if (groundingChunks) {
        this.currentGrounding = groundingChunks.map(chunk => ({
          title: chunk.web?.title || chunk.maps?.title || 'Source',
          uri: chunk.web?.uri || chunk.maps?.uri || '#',
        })).filter(source => source.uri !== '#');
      }

      this.onTranscriptUpdate({ author: 'bot', text: this.currentOutputTranscription, isFinal: false, grounding: this.currentGrounding });
    }

    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
    if (audioData) {
      await this.playStreamedAudio(audioData);
    }

    if (message.serverContent?.turnComplete) {
      this.onStatusUpdate(AppStatus.LISTENING);
      if (this.currentInputTranscription) {
        this.onTranscriptUpdate({ author: 'user', text: this.currentInputTranscription, isFinal: true });
        this.currentInputTranscription = '';
      }
      if (this.currentOutputTranscription) {
        this.onTranscriptUpdate({ author: 'bot', text: this.currentOutputTranscription, isFinal: true, grounding: this.currentGrounding });
        this.currentOutputTranscription = '';
        this.currentGrounding = [];
      }
    }
  }
  
  private async playStreamedAudio(base64Audio: string) {
    if (!this.outputAudioContext) return;
    this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);

    const audioBuffer = await decodeAudioData(decode(base64Audio), this.outputAudioContext, 24000, 1);
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputAudioContext.destination);

    source.addEventListener('ended', () => {
      this.outputSources.delete(source);
    });

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
    this.outputSources.add(source);
  }

  private handleSessionError(e: ErrorEvent) {
    console.error("Session error:", e);
    playError();
    let userMessage = "An unexpected error occurred with the AI service.";
    if (e.message) {
      const message = e.message.toLowerCase();
      if (message.includes('api key not valid')) {
        userMessage = "The API key is invalid. Please check your configuration.";
      } else if (message.includes('network') || message.includes('failed to fetch')) {
        userMessage = "A network error occurred. Please check your internet connection.";
      } else if (message.includes('permission denied')) {
        userMessage = "Could not connect to the AI service due to a permission issue.";
      } else if (message.includes('quota')) {
        userMessage = "You have exceeded your API quota. Please check your account.";
      }
    }
    this.onStatusUpdate(AppStatus.ERROR, userMessage);
    this.stopSession();
  }

  private handleSessionClose() {
    console.log("Session closed.");
  }
}