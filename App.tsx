import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AppStatus, TranscriptTurn, GroundingSource } from './types';
import { GeminiService } from './services/geminiService';
import { StopIcon, BotIcon, UserIcon, MicIcon, LinkIcon } from './components/icons';
import { Avatar } from './components/Avatar';
import { playProcessing } from './utils/audioCues';

const GroundingAttribution: React.FC<{ sources?: GroundingSource[] }> = ({ sources }) => {
    if (!sources || sources.length === 0) {
        return null;
    }

    return (
        <div className="mt-2 flex flex-wrap gap-2">
            {sources.map((source, index) => (
                <a
                    key={index}
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 bg-secondary hover:bg-secondary/80 px-2 py-1 rounded-full text-xs text-secondary-foreground transition-colors"
                    aria-label={`Source: ${source.title}`}
                >
                    <LinkIcon className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{source.title}</span>
                </a>
            ))}
        </div>
    );
};

// Simple text cleanup
const cleanText = (text: string) => {
    return text.replace(/\[Preview\]/gi, '').replace(/<noise>/gi, '').trim();
}

const renderTextWithLinks = (text: string) => {
    const cleanedText = cleanText(text);
    const linkRegex = /(\bhttps?:\/\/[^\s]+)|(\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b)/g;
    const parts = cleanedText.split(linkRegex).filter(part => part);

    return parts.map((part, index) => {
        if (part.startsWith('http')) {
            const displayUrl = part.length > 50 ? part.substring(0, 47) + '...' : part;
            return <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" title={part}>{displayUrl}</a>;
        }
        // Basic phone number check
        if (/[0-9-()+\s]{7,}/.test(part)) {
            const cleanedNumber = part.replace(/[^\d+]/g, '');
            return <a key={index} href={`tel:${cleanedNumber}`} className="text-blue-400 hover:underline">{part}</a>;
        }
        return part;
    });
};


const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const geminiServiceRef = useRef<GeminiService | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const handleTranscriptUpdate = useCallback((newTurn: TranscriptTurn) => {
    setTranscript(prev => {
      const lastTurnIndex = prev.findLastIndex(turn => turn.author === newTurn.author && !turn.isFinal);
  
      if (lastTurnIndex !== -1) {
        const updatedTranscript = [...prev];
        updatedTranscript[lastTurnIndex] = newTurn;
        return updatedTranscript;
      } else {
        return [...prev, newTurn];
      }
    });
  }, []);

  const handleStatusUpdate = useCallback((newStatus: AppStatus, message?: string) => {
    if (statusRef.current === AppStatus.PROCESSING && newStatus !== AppStatus.PROCESSING) {
        // Transitioning out of processing
    } else if (statusRef.current !== AppStatus.PROCESSING && newStatus === AppStatus.PROCESSING) {
        playProcessing();
    }

    setStatus(newStatus);
    if (newStatus === AppStatus.ERROR) {
      setErrorMessage(message || "An error occurred. Please try again.");
      setTranscript([]);
    } else {
      setErrorMessage(null);
    }
  }, []);
  
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const startConversation = async () => {
    if (status !== AppStatus.IDLE && status !== AppStatus.ERROR) return;

    setTranscript([]);
    setStatus(AppStatus.GREETING);
    
    try {
      const service = new GeminiService(handleTranscriptUpdate, handleStatusUpdate);
      geminiServiceRef.current = service;
      await service.playGreetingAndStartSession();
    } catch (error) {
      console.error("Failed to start session:", error);
      const message = error instanceof Error ? error.message : "Failed to initialize AI service.";
      handleStatusUpdate(AppStatus.ERROR, message);
    }
  };

  const stopConversation = () => {
    geminiServiceRef.current?.stopSession();
    geminiServiceRef.current = null;
    setStatus(AppStatus.IDLE);
    setTranscript([]);
  };
  
  const getStatusText = () => {
    switch (status) {
        case AppStatus.GREETING:
            return "Connecting...";
        case AppStatus.LISTENING:
            return "Listening...";
        case AppStatus.PROCESSING:
            return "Thinking...";
        case AppStatus.SPEAKING:
            return "Speaking...";
        case AppStatus.IDLE:
        case AppStatus.ERROR:
             return "";
        default:
            return "";
    }
  }

  const hasStarted = status !== AppStatus.IDLE && status !== AppStatus.ERROR;
  const ActionButton = () => {
    if (!hasStarted) return null;

    const isListening = status === AppStatus.LISTENING;
    const Icon = isListening || status === AppStatus.GREETING || status === AppStatus.PROCESSING || status === AppStatus.SPEAKING
      ? StopIcon 
      : MicIcon;

    return (
      <button
        onClick={stopConversation}
        className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50
          ${isListening ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500 animate-pulse' : 'bg-destructive/80 hover:bg-destructive focus:ring-destructive'}
        `}
        aria-label="Stop Conversation"
      >
        <Icon className="w-8 h-8 text-destructive-foreground" />
      </button>
    );
  }

  return (
    <div className="bg-background text-foreground min-h-screen flex flex-col items-center font-sans">
      
      <main className="w-full max-w-2xl flex-grow flex flex-col justify-center items-center p-4">
        {hasStarted ? (
          /* In-Conversation View */
          <div className="w-full flex-grow flex flex-col">
            <div className="text-center py-2 flex-shrink-0">
              <p className="text-sm text-muted-foreground h-5">{getStatusText()}</p>
            </div>
            <div className="flex-grow w-full overflow-y-auto scroll-smooth">
                <div className="space-y-6 p-4">
                    {transcript.map((turn, index) => {
                       if (turn.author === 'bot') {
                        return (
                            <div key={index} className="flex items-start gap-3 justify-start">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                                    <BotIcon className="w-5 h-5 text-primary-foreground" />
                                </div>
                                <div className="max-w-xs md:max-w-md">
                                    {!turn.isFinal && cleanText(turn.text).length > 0 && (
                                        <div className="bg-foreground/10 text-foreground/80 text-[10px] font-semibold px-2 py-0.5 rounded-sm mb-1 inline-block">
                                            Preview
                                        </div>
                                    )}
                                    <div className={`bg-secondary text-secondary-foreground rounded-lg px-4 py-3`}>
                                        <p className={`${!turn.isFinal ? 'opacity-70' : ''}`}>
                                            {renderTextWithLinks(turn.text)}
                                        </p>
                                    </div>
                                    {turn.isFinal && <GroundingAttribution sources={turn.grounding} />}
                                </div>
                            </div>
                        )
                       } else {
                        return (
                            <div key={index} className="flex items-start gap-3 justify-end">
                                <div className="max-w-xs md:max-w-md">
                                    <div className={`bg-primary text-primary-foreground rounded-lg px-4 py-3 ${!turn.isFinal ? 'opacity-70' : ''}`}>
                                        <p>{cleanText(turn.text)}</p>
                                    </div>
                                </div>
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                    <UserIcon className="w-5 h-5 text-muted-foreground" />
                                </div>
                            </div>
                        )
                       }
                    })}
                    <div ref={transcriptEndRef} />
                </div>
            </div>
          </div>
        ) : (
          /* Initial View */
          <div className="flex-grow w-full flex flex-col items-center justify-evenly text-center p-4">
            <Avatar status={status} size="large" />

            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Indian Language Voice Assistant</h1>
              <p className="mt-4 text-lg text-muted-foreground">Ask me anything in your language</p>
              <p className="mt-2 text-sm text-muted-foreground/80">Please allow microphone access to begin.</p>
            </div>
            
            <div>
              <button
                  onClick={startConversation}
                  className="w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50 bg-primary hover:bg-primary/90 focus:ring-ring"
                  aria-label="Start Conversation"
              >
                  <MicIcon className="w-10 h-10 text-primary-foreground" />
              </button>
              <p className="mt-4 text-sm text-destructive h-5">{status === AppStatus.ERROR ? errorMessage : ''}</p>
            </div>
          </div>
        )}
      </main>

      <footer className="w-full max-w-2xl p-4 flex flex-col items-center justify-center z-10 flex-shrink-0 min-h-[116px]">
        {hasStarted && <ActionButton />}
      </footer>
    </div>
  );
};

export default App;