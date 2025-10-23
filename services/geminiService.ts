// Fix: The 'LiveSession' type is not exported from the '@google/genai' module.
// It has been replaced with a locally defined interface to match the expected session object structure.
// The 'Blob' type, which is used by the session, has been imported instead.
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from "@google/genai";
import { AppStatus, TranscriptTurn } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';

type TranscriptCallback = (turn: TranscriptTurn) => void;
type StatusCallback = (status: AppStatus) => void;

// Fix: Define the LiveSession interface as it's not exported from @google/genai.
// This interface is based on the usage of the session object in this service.
interface LiveSession {
  close(): void;
  sendRealtimeInput(input: { media: Blob }): void;
}

export class GeminiService {
  private ai: GoogleGenAI;
  private onTranscriptUpdate: TranscriptCallback;
  private onStatusUpdate: StatusCallback;
  private gender: 'male' | 'female';

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

  constructor(onTranscriptUpdate: TranscriptCallback, onStatusUpdate: StatusCallback, gender: 'male' | 'female') {
    if (!process.env.API_KEY) {
      throw new Error("API_KEY environment variable not set");
    }
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onStatusUpdate = onStatusUpdate;
    this.gender = gender;
  }

  public async startSession(): Promise<void> {
    this.onStatusUpdate(AppStatus.PROCESSING);
    
    // Fix: Cast window to `any` to support `webkitAudioContext` for older browsers.
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

    const voiceName = this.gender === 'male' ? 'Fenrir' : 'Kore';

    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        systemInstruction: "You are a helpful and friendly assistant. Your default language is English. If the user speaks to you in a different language, such as an Indian language, you must identify that language and respond fluently in the same language for the rest of the conversation. Only switch back to English if the user switches back. For questions that require current information, use your search tool to find the most up-to-date and accurate answer before responding.",
        tools: [{googleSearch: {}}]
      },
      callbacks: {
        onopen: this.handleSessionOpen.bind(this),
        onmessage: this.handleSessionMessage.bind(this),
        onerror: this.handleSessionError.bind(this),
        onclose: this.handleSessionClose.bind(this),
      },
    });

    this.session = await this.sessionPromise;
  }

  public stopSession(): void {
    this.onStatusUpdate(AppStatus.IDLE);
    this.session?.close();
    
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

    this.session = null;
    this.sessionPromise = null;
  }
  
  private async handleSessionOpen() {
    this.onStatusUpdate(AppStatus.LISTENING);
    
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
      this.onStatusUpdate(AppStatus.ERROR);
      this.stopSession();
    }
  }

  private async handleSessionMessage(message: LiveServerMessage) {
    if (message.serverContent?.inputTranscription) {
      this.onStatusUpdate(AppStatus.PROCESSING);
      const text = message.serverContent.inputTranscription.text;
      this.currentInputTranscription += text;
      this.onTranscriptUpdate({ author: 'user', text: this.currentInputTranscription, isFinal: false });
    }
    
    if (message.serverContent?.outputTranscription) {
      this.onStatusUpdate(AppStatus.SPEAKING);
      const text = message.serverContent.outputTranscription.text;
      this.currentOutputTranscription += text;
      this.onTranscriptUpdate({ author: 'bot', text: this.currentOutputTranscription, isFinal: false });
    }

    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
    if (audioData) {
      await this.playAudio(audioData);
    }
    
    if (message.serverContent?.turnComplete) {
      this.onStatusUpdate(AppStatus.LISTENING);
      if (this.currentInputTranscription) {
        this.onTranscriptUpdate({ author: 'user', text: this.currentInputTranscription, isFinal: true });
        this.currentInputTranscription = '';
      }
      if (this.currentOutputTranscription) {
        this.onTranscriptUpdate({ author: 'bot', text: this.currentOutputTranscription, isFinal: true });
        this.currentOutputTranscription = '';
      }
    }
  }

  private async playAudio(base64Audio: string) {
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
    this.onStatusUpdate(AppStatus.ERROR);
    this.stopSession();
  }

  private handleSessionClose(e: CloseEvent) {
    console.log("Session closed.");
    if (this.session) {
        this.stopSession();
    }
  }
}