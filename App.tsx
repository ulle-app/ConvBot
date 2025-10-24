import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AppStatus, TranscriptTurn, GroundingSource } from './types';
import { GeminiService } from './services/geminiService';
import { StopIcon, BotIcon, UserIcon, MaleIcon, FemaleIcon, LinkIcon } from './components/icons';
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
                    className="flex items-center gap-1.5 bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded-full text-xs text-gray-300 transition-colors"
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
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | null>(null);
  const geminiServiceRef = useRef<GeminiService | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const handleTranscriptUpdate = useCallback((newTurn: TranscriptTurn) => {
    setTranscript(prev => {
      // Find if there's an existing non-final turn from the same author
      const lastTurnIndex = prev.findLastIndex(turn => turn.author === newTurn.author && !turn.isFinal);
  
      if (lastTurnIndex !== -1) {
        // Update the existing non-final turn
        const updatedTranscript = [...prev];
        updatedTranscript[lastTurnIndex] = newTurn;
        return updatedTranscript;
      } else {
        // Add the new turn
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
      setSelectedGender(null);
      setTranscript([]);
    } else {
      setErrorMessage(null);
    }
  }, []);
  
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const startConversation = async (gender: 'male' | 'female') => {
    if (status !== AppStatus.IDLE && status !== AppStatus.ERROR) return;

    setTranscript([]);
    setSelectedGender(gender);
    setStatus(AppStatus.PROCESSING);
    
    try {
      const service = new GeminiService(handleTranscriptUpdate, handleStatusUpdate, gender);
      await service.startSession();
      geminiServiceRef.current = service;
    } catch (error) {
      console.error("Failed to start session:", error);
      const message = error instanceof Error ? error.message : "Failed to initialize AI service.";
      handleStatusUpdate(AppStatus.ERROR, message);
      setSelectedGender(null);
    }
  };

  const stopConversation = () => {
    geminiServiceRef.current?.stopSession();
    geminiServiceRef.current = null;
    setStatus(AppStatus.IDLE);
    setSelectedGender(null);
    setTranscript([]);
  };
  
  const getStatusText = () => {
    switch (status) {
        case AppStatus.LISTENING:
            return "Listening...";
        case AppStatus.PROCESSING:
            return "Thinking...";
        case AppStatus.SPEAKING:
            return "Speaking...";
        case AppStatus.IDLE:
        case AppStatus.ERROR:
             return ""; // Status handled on landing page or implicitly by session end
        default:
            return "";
    }
  }

  const hasStarted = status !== AppStatus.IDLE && status !== AppStatus.ERROR;

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center font-sans">
      
      {/* Main Content Area */}
      <main className="w-full max-w-2xl flex-grow flex flex-col justify-center items-center p-4">
        {hasStarted ? (
          /* In-Conversation View */
          <div className="w-full flex-grow flex flex-col">
            <div className="flex-shrink-0 py-4 flex flex-col items-center justify-center">
              <Avatar status={status} size="small" />
              <p className="mt-2 text-sm text-gray-400 h-5">{getStatusText()}</p>
            </div>
            <div className="flex-grow w-full overflow-y-auto scroll-smooth">
                <div className="space-y-6">
                    {transcript.map((turn, index) => (
                        <div key={index} className={`flex items-start gap-3 ${turn.author === 'user' ? 'justify-end' : 'justify-start'}`}>
                          {turn.author === 'bot' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center"><BotIcon className="w-5 h-5" /></div>}
                          <div className={`max-w-xs md:max-w-md`}>
                            <div className={`px-4 py-2 rounded-2xl ${turn.author === 'user' ? 'bg-blue-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'} ${!turn.isFinal ? 'opacity-70' : ''}`}>
                                <p>{turn.author === 'bot' ? renderTextWithLinks(turn.text) : cleanText(turn.text)}</p>
                            </div>
                            {turn.author === 'bot' && turn.isFinal && <GroundingAttribution sources={turn.grounding} />}
                          </div>
                          {turn.author === 'user' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center"><UserIcon className="w-5 h-5" /></div>}
                        </div>
                    ))}
                    <div ref={transcriptEndRef} />
                </div>
            </div>
          </div>
        ) : (
          /* Initial View */
          <div className="flex-grow flex flex-col items-center justify-center text-center">
              <Avatar status={status} size="large" />
              <div className="mt-8">
                <h1 className="text-2xl font-bold text-gray-200">Indian Language Voice Assistant</h1>
                <p className="text-md text-gray-400">Ask me anything in your language</p>
                <p className="mt-4 text-sm text-gray-500">Please allow microphone access to begin.</p>
              </div>
              
              {/* Start Buttons */}
              <div className="mt-12 flex flex-col sm:flex-row gap-4 w-full max-w-sm">
                <button
                    onClick={() => startConversation('male')}
                    className="flex w-full justify-center items-center space-x-3 px-6 py-4 rounded-full text-lg font-semibold transition-all duration-200 ease-in-out border-2 bg-indigo-500 border-indigo-500 text-white hover:bg-indigo-600 hover:border-indigo-600 focus:outline-none focus:ring-4 focus:ring-indigo-500 focus:ring-opacity-50"
                >
                    <MaleIcon className="w-7 h-7" />
                    <span>Male Voice</span>
                </button>
                <button
                    onClick={() => startConversation('female')}
                    className="flex w-full justify-center items-center space-x-3 px-6 py-4 rounded-full text-lg font-semibold transition-all duration-200 ease-in-out border-2 bg-pink-500 border-pink-500 text-white hover:bg-pink-600 hover:border-pink-600 focus:outline-none focus:ring-4 focus:ring-pink-500 focus:ring-opacity-50"
                >
                    <FemaleIcon className="w-7 h-7" />
                    <span>Female Voice</span>
                </button>
              </div>
              <p className="mt-8 text-sm text-red-400 h-5">{status === AppStatus.ERROR ? errorMessage : ''}</p>
          </div>
        )}
      </main>

      {/* Footer Controls */}
      <footer className="w-full max-w-2xl p-4 flex flex-col items-center justify-center z-10 flex-shrink-0 min-h-[116px]">
        {hasStarted && (
            <button
              onClick={stopConversation}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50 bg-red-600 hover:bg-red-700 focus:ring-red-500
                ${status === AppStatus.LISTENING ? 'animate-pulse' : ''}
              `}
            >
              <StopIcon className="w-8 h-8" />
            </button>
        )}
      </footer>
    </div>
  );
};

export default App;