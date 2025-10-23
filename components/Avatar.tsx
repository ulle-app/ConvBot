import React from 'react';
import { AppStatus } from '../types';

interface AvatarProps {
  status: AppStatus;
  size?: 'small' | 'large';
}

const OrbAvatar: React.FC<{ status: AppStatus }> = ({ status }) => (
    <svg width="100%" height="100%" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <radialGradient id="orb-glow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                <stop offset="0%" stopColor="rgba(129, 140, 248, 0.8)" />
                <stop offset="60%" stopColor="rgba(99, 102, 241, 0.6)" />
                <stop offset="100%" stopColor="rgba(79, 70, 229, 0)" />
            </radialGradient>
            <radialGradient id="orb-core" cx="50%" cy="50%" r="50%" fx="55%" fy="45%">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 1)" />
                <stop offset="100%" stopColor="rgba(199, 210, 254, 1)" />
            </radialGradient>
        </defs>

        {/* Outer Glow */}
        <circle cx="100" cy="100" r="100" fill="url(#orb-glow)" />

        {/* Speaking Ripple */}
        {status === AppStatus.SPEAKING && (
            <circle cx="100" cy="100" r="70" stroke="#a5b4fc" strokeWidth="2" className="animate-speak-ripple" />
        )}
        
        {/* Main Orb */}
        <circle cx="100" cy="100" r="70" fill="rgba(79, 70, 229, 0.8)" stroke="#a5b4fc" strokeWidth="1" />
        
        {/* Core */}
        <circle cx="100" cy="100" r="50" fill="url(#orb-core)" className={status === AppStatus.SPEAKING ? 'animate-speak-pulse' : ''} />
    </svg>
);


export const Avatar: React.FC<AvatarProps> = ({ status, size = 'large' }) => {
  const sizeClasses = size === 'large' ? 'w-48 h-48 md:w-64 md:h-64' : 'w-24 h-24';

  const getStatusClasses = () => {
    switch (status) {
      case AppStatus.LISTENING:
        return 'animate-pulse';
      case AppStatus.PROCESSING:
        return 'animate-spin';
      default:
        return '';
    }
  };

  return (
    <div className={`relative flex items-center justify-center transition-all duration-500 ${sizeClasses}`}>
      <div className={getStatusClasses()}>
          <OrbAvatar status={status} />
      </div>
    </div>
  );
};