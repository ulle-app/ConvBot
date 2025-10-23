import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AppStatus, TranscriptTurn } from './types';
import { GeminiService } from './services/geminiService';
import { MicIcon, StopIcon, BotIcon, UserIcon, MaleIcon, FemaleIcon } from './components/icons';
import { Avatar } from './components/Avatar';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [selectedGender, setSelectedGender] = useState<'male' | 'female' | null>(null);
  const geminiServiceRef = useRef<GeminiService | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const handleTranscriptUpdate = useCallback((newTurn: TranscriptTurn) => {
    setTranscript(prev => {
      const newTranscript = [...prev];
      let lastTurnIndex = -1;
      for (let i = newTranscript.length - 1; i >= 0; i--) {
          if (newTranscript[i].author === newTurn.author && !newTranscript[i].isFinal) {
              lastTurnIndex = i;
              break;
          }
      }

      if (lastTurnIndex !== -1) {
        newTranscript[lastTurnIndex] = newTurn;
      } else {
        newTranscript.push(newTurn);
      }
      return newTranscript;
    });
  }, []);

  const handleStatusUpdate = useCallback((newStatus: AppStatus) => {
    setStatus(newStatus);
  }, []);
  
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const toggleConversation = async () => {
    if (!selectedGender && (status === AppStatus.IDLE || status === AppStatus.ERROR)) {
        return; // Do nothing if gender is not selected
    }
      
    if (status === AppStatus.IDLE || status === AppStatus.ERROR) {
      setTranscript([]);
      try {
        const service = new GeminiService(handleTranscriptUpdate, handleStatusUpdate, selectedGender!);
        await service.startSession();
        geminiServiceRef.current = service;
      } catch (error) {
        console.error("Failed to start session:", error);
        setStatus(AppStatus.ERROR);
      }
    } else {
      geminiServiceRef.current?.stopSession();
      geminiServiceRef.current = null;
      setStatus(AppStatus.IDLE);
      setSelectedGender(null); // Reset gender selection
    }
  };
  
  const getStatusText = () => {
    if (status === AppStatus.IDLE && !selectedGender) {
        return "Select a voice to begin";
    }
    switch (status) {
        case AppStatus.LISTENING:
            return "Listening...";
        case AppStatus.PROCESSING:
            return "Thinking...";
        case AppStatus.SPEAKING:
            return "Speaking...";
        case AppStatus.IDLE:
             return "Tap the mic to start";
        case AppStatus.ERROR:
            return "An error occurred. Please try again.";
        default:
            return "Select a voice to begin";
    }
  }

  const hasStarted = transcript.length > 0;

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center font-sans">
      
      {/* Main Content Area */}
      <main className="w-full max-w-2xl flex-grow flex flex-col justify-center items-center p-4">
        {hasStarted ? (
          /* In-Conversation View */
          <div className="w-full flex-grow flex flex-col">
            <div className="flex-shrink-0 py-4 flex flex-col items-center justify-center">
              <Avatar status={status} size="small" />
            </div>
            <div className="flex-grow w-full overflow-y-auto scroll-smooth">
                <div className="space-y-6">
                    {transcript.map((turn, index) => (
                        <div key={index} className={`flex items-start gap-3 ${turn.author === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {turn.author === 'bot' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center"><BotIcon className="w-5 h-5" /></div>}
                        <div className={`max-w-xs md:max-w-md px-4 py-2 rounded-2xl ${turn.author === 'user' ? 'bg-blue-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'} ${!turn.isFinal ? 'opacity-70' : ''}`}>
                            <p>{turn.text}</p>
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
              </div>
              
              {/* Gender Selection */}
              <div className="mt-8 flex space-x-4">
                <button
                    onClick={() => setSelectedGender('male')}
                    className={`flex items-center space-x-2 px-6 py-3 rounded-full text-lg font-semibold transition-all duration-200 ease-in-out border-2
                        ${selectedGender === 'male' ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-transparent border-gray-600 text-gray-400 hover:border-indigo-500 hover:text-white'}
                    `}
                >
                    <MaleIcon className="w-6 h-6" />
                    <span>Male</span>
                </button>
                <button
                    onClick={() => setSelectedGender('female')}
                    className={`flex items-center space-x-2 px-6 py-3 rounded-full text-lg font-semibold transition-all duration-200 ease-in-out border-2
                        ${selectedGender === 'female' ? 'bg-pink-500 border-pink-500 text-white' : 'bg-transparent border-gray-600 text-gray-400 hover:border-pink-500 hover:text-white'}
                    `}
                >
                    <FemaleIcon className="w-6 h-6" />
                    <span>Female</span>
                </button>
              </div>
          </div>
        )}
      </main>

      {/* Footer Controls */}
      <footer className="w-full max-w-2xl p-4 flex flex-col items-center justify-center z-10 flex-shrink-0">
        <button
          onClick={toggleConversation}
          disabled={!selectedGender && status === AppStatus.IDLE}
          className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50
            ${status !== AppStatus.IDLE && status !== AppStatus.ERROR ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500'}
            ${status === AppStatus.LISTENING ? 'animate-pulse' : ''}
            ${!selectedGender && status === AppStatus.IDLE ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          {status === AppStatus.IDLE || status === AppStatus.ERROR ? (
            <MicIcon className="w-8 h-8" />
          ) : (
            <StopIcon className="w-8 h-8" />
          )}
        </button>
         <p className="mt-4 text-sm text-gray-400 h-5">{getStatusText()}</p>
      </footer>
    </div>
  );
};

export default App;