
export enum AppStatus {
  IDLE = 'IDLE',
  GREETING = 'GREETING',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR',
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface TranscriptTurn {
  author: 'user' | 'bot';
  text: string;
  isFinal: boolean;
  grounding?: GroundingSource[];
}
